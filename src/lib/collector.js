import { CACHE_DIR, STATE_PATH } from "./paths.js";
import { readJson, writeJson } from "./storage.js";
import { buildTerms } from "./locations.js";
import { classifyLocation } from "./classifier.js";
import { dedupeUsers } from "./ranking.js";
import { buildSearchQuery, FIRST_GITHUB_USER_DATE, SEARCH_RESULT_CAP, taskKey } from "./query.js";
import { splitTask } from "./sharding.js";
import { formatDate, monthsAgo, previousDate, rollingContributionWindow } from "./dates.js";
import { shouldStopForBudget, waitForRateLimit, defaultSleep } from "./rate-limit.js";

const DEFAULT_STATE = {
  version: 1,
  queue: [],
  completed: {},
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  stats: { queries: 0, usersSeen: 0, usersKept: 0 }
};

export async function collect({
  countries,
  client,
  maxQueries = 120,
  dryRun = false,
  now = new Date(),
  sleep = defaultSleep
}) {
  const state = await loadState(countries, now);
  const caches = await loadCaches(countries);
  const contributionWindow = rollingContributionWindow(now);
  let queries = 0;
  let lastRateLimit = null;
  state.lastRunStartedAt = now.toISOString();

  while (state.queue.length && queries < maxQueries) {
    const task = state.queue.shift();
    const key = taskKey(task);
    if (state.completed[key]) continue;

    const queriesBeforeTask = queries;
    const query = buildSearchQuery(task);
    const firstPage = await requestWithBackoff(client, { query, first: 100, after: null, contributionWindow }, sleep);
    queries += 1;
    lastRateLimit = firstPage.rateLimit;

    if (firstPage.total > SEARCH_RESULT_CAP) {
      state.stats.queries += queries - queriesBeforeTask;
      state.queue.unshift(...splitTask(task));
      await persist(state, caches, dryRun);
      continue;
    }

    let users = [...firstPage.users];
    let pageInfo = firstPage.pageInfo;

    while (pageInfo.hasNextPage && queries < maxQueries) {
      await sleep(1500);
      const page = await requestWithBackoff(client, { query, first: 100, after: pageInfo.endCursor, contributionWindow }, sleep);
      queries += 1;
      lastRateLimit = page.rateLimit;
      users.push(...page.users);
      pageInfo = page.pageInfo;
      if (shouldStopForBudget(lastRateLimit)) break;
    }

    mergeUsers(caches, countries, users);
    if (pageInfo.hasNextPage) {
      state.queue.unshift(task);
    } else {
      state.completed[key] = {
        completedAt: new Date().toISOString(),
        total: firstPage.total,
        kept: users.length
      };
    }
    state.stats.queries += queries - queriesBeforeTask;
    state.stats.usersSeen += users.length;
    state.stats.usersKept = Object.values(caches).reduce((total, list) => total + list.length, 0);

    await persist(state, caches, dryRun);
    if (shouldStopForBudget(lastRateLimit)) break;
    await sleep(1500);
  }

  state.lastRunFinishedAt = new Date().toISOString();
  await persist(state, caches, dryRun);
  return { state, queries, remainingTasks: state.queue.length };
}

async function loadState(countries, now) {
  const state = await readJson(STATE_PATH, DEFAULT_STATE);
  const cutoff = previousDate(formatDate(monthsAgo(now, 3)));
  const hasQueue = Array.isArray(state.queue) && state.queue.length > 0;
  const hasCompleted = state.completed && Object.keys(state.completed).length > 0;

  if (hasQueue || hasCompleted) return { ...DEFAULT_STATE, ...state };

  const queue = buildTerms(countries).map((term) => ({
    ...term,
    createdStart: FIRST_GITHUB_USER_DATE,
    createdEnd: cutoff
  }));
  return { ...DEFAULT_STATE, ...state, queue };
}

async function loadCaches(countries) {
  const caches = {};
  for (const country of countries) {
    caches[country.slug] = await readJson(`${CACHE_DIR}/${country.slug}.json`, []);
  }
  return caches;
}

function mergeUsers(caches, countries, users) {
  for (const user of users) {
    const slug = classifyLocation(user.location, countries);
    if (!slug) continue;
    caches[slug] = dedupeUsers([...(caches[slug] ?? []), user]);
  }
}

async function requestWithBackoff(client, request, sleep) {
  let attempt = 0;
  for (;;) {
    try {
      return await client.searchUsers(request);
    } catch (error) {
      attempt += 1;
      const waited = await waitForRateLimit(error, sleep);
      if (!waited && attempt >= 3) throw error;
      if (!waited) await sleep(2 ** attempt * 1000);
    }
  }
}

async function persist(state, caches, dryRun) {
  if (dryRun) return;
  await writeJson(STATE_PATH, state);
  for (const [slug, users] of Object.entries(caches)) {
    await writeJson(`${CACHE_DIR}/${slug}.json`, users);
  }
}
