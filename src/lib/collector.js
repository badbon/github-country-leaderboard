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
export const STATE_VERSION = 3;

const DEFAULT_STATE = {
  version: STATE_VERSION,
  countries: {},
  nextCountryIndex: 0,
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

  while (requests < maxQueries) {
    const countryState = selectNextCountry(state, countries);
    if (!countryState) break;

    const task = countryState.queue.shift();
    const key = taskKey(task);
    if (countryState.completed[key] && !task.page) continue;
    countryState.status = "discovering";

    const query = buildSearchQuery(task);
    const page = task.page ?? 1;
    console.log(`Searching ${task.country} ${task.kind}:${task.term} created:${task.createdStart}..${task.createdEnd} page:${page}`);

    let search;
    try {
      search = await requestWithBackoff(() =>
        client.searchUsers({ query, page, perPage: SEARCH_PAGE_SIZE }), sleep);
    } catch (error) {
      if (!shouldSplitAfterFailure(error)) {
        markFailed(countryState, error);
        await persist(state, caches, dryRun);
        throw error;
      }
      countryState.queue.unshift(...splitTask(task));
      await persist(state, caches, dryRun);
      continue;
    }

    requests += 1;
    state.stats.searchRequests += 1;
    countryState.stats.searchRequests += 1;

    if ((search.total > SEARCH_RESULT_CAP || search.incomplete) && page === 1) {
      countryState.queue.unshift(...splitTask(task));
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
      let response;
      try {
        response = await requestWithBackoff(() =>
          client.enrichUsers({ logins: batch, contributionWindow }), sleep);
      } catch (error) {
        if (!isRetryableApiError(error)) throw error;
        fullyEnriched = false;
        break;
      }
      requests += 1;
      state.stats.enrichmentRequests += 1;
      countryState.stats.enrichmentRequests += 1;
      enriched.push(...response.users);
      await sleep(ENRICH_DELAY_MS);
    }

    mergeUsers(caches, countries, enriched);
    state.stats.usersDiscovered += search.users.length;
    state.stats.usersEnriched += enriched.length;
    state.stats.usersKept = Object.values(caches).reduce((total, list) => total + list.length, 0);
    countryState.stats.usersDiscovered += search.users.length;
    countryState.stats.usersEnriched += enriched.length;
    countryState.stats.usersKept = caches[task.country]?.length ?? 0;
    countryState.lastDiscoveryAt = new Date().toISOString();

    const lastPage = Math.ceil(Math.min(search.total, SEARCH_RESULT_CAP) / SEARCH_PAGE_SIZE);
    if (!fullyEnriched) {
      countryState.queue.unshift({ ...task, page });
    } else if (page < lastPage) {
      countryState.queue.unshift({ ...task, page: page + 1 });
    } else {
      countryState.completed[key] = {
        completedAt: new Date().toISOString(),
        total: search.total,
        kept: enriched.length
      };
    }

    markCompleteIfDone(countryState);
    await persist(state, caches, dryRun);
    await sleep(SEARCH_DELAY_MS);
  }

  state.lastRunFinishedAt = new Date().toISOString();
  await persist(state, caches, dryRun);
  return { state, queries: requests, remainingTasks: remainingTasks(state) };
}

async function loadState(countries, now) {
  const state = await readJson(STATE_PATH, DEFAULT_STATE);
  if (state?.version !== STATE_VERSION) return createInitialState(countries, now);
  return normalizeState(state, countries, now);
}

export function createInitialState(countries, now = new Date()) {
  const cutoff = previousDate(formatDate(monthsAgo(now, 3)));
  return {
    ...DEFAULT_STATE,
    countries: Object.fromEntries(countries.map((country) => [
      country.slug,
      createCountryState(country, cutoff)
    ]))
  };
}

function normalizeState(state, countries, now) {
  const initial = createInitialState(countries, now);
  const normalized = {
    ...DEFAULT_STATE,
    ...state,
    version: STATE_VERSION,
    countries: {}
  };

  for (const country of countries) {
    normalized.countries[country.slug] = state.countries?.[country.slug]
      ? { ...initial.countries[country.slug], ...state.countries[country.slug] }
      : initial.countries[country.slug];
    normalized.countries[country.slug].stats = {
      ...initial.countries[country.slug].stats,
      ...(state.countries?.[country.slug]?.stats ?? {})
    };
    normalized.countries[country.slug].completed = state.countries?.[country.slug]?.completed ?? {};
    normalized.countries[country.slug].queue = state.countries?.[country.slug]?.queue ?? initial.countries[country.slug].queue;
    markCompleteIfDone(normalized.countries[country.slug]);
  }

  return normalized;
}

function createCountryState(country, cutoff) {
  return {
    slug: country.slug,
    status: "pending",
    queue: buildCountryQueue(country, cutoff),
    completed: {},
    lastDiscoveryAt: null,
    lastDiscoveryCompletedAt: null,
    lastContributionRefreshAt: null,
    lastError: null,
    stats: {
      searchRequests: 0,
      enrichmentRequests: 0,
      usersDiscovered: 0,
      usersEnriched: 0,
      usersKept: 0
    }
  };
}

function buildCountryQueue(country, cutoff) {
  const terms = buildTerms([country])
    .filter((term) => term.term.trim().length > 2)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
      return a.country.localeCompare(b.country) || a.term.localeCompare(b.term);
    });
  return dateRanges(FIRST_GITHUB_USER_DATE, cutoff).flatMap((range) =>
    terms.map((term) => ({ ...term, ...range }))
  );
}

export function selectNextCountry(state, countries) {
  const georgia = state.countries.georgia;
  if (georgia?.status !== "complete" && georgia?.queue?.length) return georgia;

  const rotating = countries
    .map((country) => country.slug)
    .filter((slug) => slug !== "georgia");

  for (let offset = 0; offset < rotating.length; offset += 1) {
    const index = (state.nextCountryIndex + offset) % rotating.length;
    const countryState = state.countries[rotating[index]];
    if (countryState?.status !== "complete" && countryState?.queue?.length) {
      state.nextCountryIndex = (index + 1) % rotating.length;
      return countryState;
    }
  }

  return null;
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

function markCompleteIfDone(countryState) {
  if (!countryState.queue.length && countryState.status !== "complete") {
    countryState.status = "complete";
    countryState.lastDiscoveryCompletedAt = new Date().toISOString();
    countryState.lastError = null;
  }
}

function markFailed(countryState, error) {
  countryState.status = "failed";
  countryState.lastError = {
    message: error.message,
    status: error.status ?? null,
    at: new Date().toISOString()
  };
}

function remainingTasks(state) {
  return Object.values(state.countries ?? {}).reduce((total, countryState) =>
    total + (countryState.queue?.length ?? 0), 0);
}

async function requestWithBackoff(request, sleep) {
  let attempt = 0;
  for (;;) {
    try {
      return await request();
    } catch (error) {
      if (!isRetryableApiError(error)) throw error;
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

function isRetryableApiError(error) {
  return Boolean(
    error.timeout ||
    error.resourceLimit ||
    error.status === 403 ||
    error.status === 429 ||
    (error.status >= 500 && error.status < 600)
  );
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
