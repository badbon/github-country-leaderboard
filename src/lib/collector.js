import { CACHE_DIR, STATE_PATH } from "./paths.js";
import { readJson, writeJson } from "./storage.js";
import { buildTerms } from "./locations.js";
import { classifyLocation } from "./classifier.js";
import { dedupeUsers } from "./ranking.js";
import { buildSearchQuery, FIRST_GITHUB_USER_DATE, SEARCH_RESULT_CAP, taskKey } from "./query.js";
import { splitTask } from "./sharding.js";
import { formatDate, monthsAgo, previousDate, rollingContributionWindow } from "./dates.js";
import { waitForRateLimit, defaultSleep } from "./rate-limit.js";

const SEARCH_PAGE_SIZE = 100;
const ENRICH_BATCH_SIZE = 20;
const DISCOVERY_SHARD_DAYS = 365;
const SEARCH_DELAY_MS = 2100;
const ENRICH_DELAY_MS = 250;

const DEFAULT_STATE = {
  version: 2,
  queue: [],
  completed: {},
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  stats: {
    searchRequests: 0,
    enrichmentRequests: 0,
    usersDiscovered: 0,
    usersEnriched: 0,
    usersKept: 0
  }
};

export async function collect({
  countries,
  client,
  maxQueries = 900,
  dryRun = false,
  now = new Date(),
  sleep = defaultSleep
}) {
  const state = await loadState(countries, now);
  const caches = await loadCaches(countries);
  const contributionWindow = rollingContributionWindow(now);
  let requests = 0;
  state.lastRunStartedAt = now.toISOString();

  while (state.queue.length && requests < maxQueries) {
    const task = state.queue.shift();
    const key = taskKey(task);
    if (state.completed[key] && !task.page) continue;

    const query = buildSearchQuery(task);
    const page = task.page ?? 1;
    console.log(`Searching ${task.country} ${task.kind}:${task.term} created:${task.createdStart}..${task.createdEnd} page:${page}`);

    let search;
    try {
      search = await requestWithBackoff(() =>
        client.searchUsers({ query, page, perPage: SEARCH_PAGE_SIZE }), sleep);
    } catch (error) {
      if (!shouldSplitAfterFailure(error)) throw error;
      state.queue.unshift(...splitTask(task));
      await persist(state, caches, dryRun);
      continue;
    }

    requests += 1;
    state.stats.searchRequests += 1;

    if ((search.total > SEARCH_RESULT_CAP || search.incomplete) && page === 1) {
      state.queue.unshift(...splitTask(task));
      await persist(state, caches, dryRun);
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    const enriched = [];
    const logins = unique(search.users.map((user) => user.login));
    let fullyEnriched = true;
    for (const batch of chunks(logins, ENRICH_BATCH_SIZE)) {
      if (requests >= maxQueries) {
        fullyEnriched = false;
        break;
      }
      const response = await requestWithBackoff(() =>
        client.enrichUsers({ logins: batch, contributionWindow }), sleep);
      requests += 1;
      state.stats.enrichmentRequests += 1;
      enriched.push(...response.users);
      await sleep(ENRICH_DELAY_MS);
    }

    mergeUsers(caches, countries, enriched);
    state.stats.usersDiscovered += search.users.length;
    state.stats.usersEnriched += enriched.length;
    state.stats.usersKept = Object.values(caches).reduce((total, list) => total + list.length, 0);

    const lastPage = Math.ceil(Math.min(search.total, SEARCH_RESULT_CAP) / SEARCH_PAGE_SIZE);
    if (!fullyEnriched) {
      state.queue.unshift({ ...task, page });
    } else if (page < lastPage) {
      state.queue.unshift({ ...task, page: page + 1 });
    } else {
      state.completed[key] = {
        completedAt: new Date().toISOString(),
        total: search.total,
        kept: enriched.length
      };
    }

    await persist(state, caches, dryRun);
    await sleep(SEARCH_DELAY_MS);
  }

  state.lastRunFinishedAt = new Date().toISOString();
  await persist(state, caches, dryRun);
  return { state, queries: requests, remainingTasks: state.queue.length };
}

async function loadState(countries, now) {
  const state = await readJson(STATE_PATH, DEFAULT_STATE);
  const cutoff = previousDate(formatDate(monthsAgo(now, 3)));
  if (state.version === 2 && (state.queue?.length || Object.keys(state.completed ?? {}).length)) {
    return { ...DEFAULT_STATE, ...state };
  }

  return { ...DEFAULT_STATE, queue: buildInitialQueue(countries, cutoff) };
}

function buildInitialQueue(countries, cutoff) {
  const terms = buildTerms(countries)
    .filter((term) => term.term.trim().length > 2)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
      return a.country.localeCompare(b.country) || a.term.localeCompare(b.term);
    });
  return dateRanges(FIRST_GITHUB_USER_DATE, cutoff).flatMap((range) =>
    terms.map((term) => ({ ...term, ...range }))
  );
}

function dateRanges(start, end) {
  const ranges = [];
  let current = new Date(`${start}T00:00:00Z`);
  const final = new Date(`${end}T00:00:00Z`);

  while (current <= final) {
    const shardStart = formatDate(current);
    const shardEndDate = new Date(current.getTime());
    shardEndDate.setUTCDate(shardEndDate.getUTCDate() + DISCOVERY_SHARD_DAYS - 1);
    const shardEnd = formatDate(new Date(Math.min(shardEndDate.getTime(), final.getTime())));
    ranges.push({ createdStart: shardStart, createdEnd: shardEnd });
    current = new Date(`${shardEnd}T00:00:00Z`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return ranges.reverse();
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

async function requestWithBackoff(request, sleep) {
  let attempt = 0;
  for (;;) {
    try {
      return await request();
    } catch (error) {
      if (shouldSplitAfterFailure(error)) throw error;
      if (error.status && error.status !== 403 && error.status !== 429) throw error;
      attempt += 1;
      const waited = await waitForRateLimit(error, sleep);
      if (!waited && attempt >= 3) throw error;
      if (!waited) await sleep(2 ** attempt * 1000);
    }
  }
}

function shouldSplitAfterFailure(error) {
  return error.timeout || error.resourceLimit || error.status === 502 || error.status === 503 || error.status === 504;
}

async function persist(state, caches, dryRun) {
  if (dryRun) return;
  await writeJson(STATE_PATH, state);
  for (const [slug, users] of Object.entries(caches)) {
    await writeJson(`${CACHE_DIR}/${slug}.json`, users);
  }
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
