import { CACHE_DIR, STATE_PATH } from "./paths.js";
import { readJson, writeJson } from "./storage.js";
import { buildTerms } from "./locations.js";
import { classifyLocation } from "./classifier.js";
import { buildSearchQuery, FIRST_GITHUB_USER_DATE, SEARCH_RESULT_CAP, taskKey } from "./query.js";
import { splitTask } from "./sharding.js";
import { formatDate, monthsAgo, nextDate, previousDate, rollingContributionWindow } from "./dates.js";
import { waitForRateLimit, defaultSleep } from "./rate-limit.js";

const SEARCH_PAGE_SIZE = 100;
const ENRICH_BATCH_SIZE = 20;
const DISCOVERY_SHARD_DAYS = 365;
const SEARCH_DELAY_MS = 2100;
const ENRICH_DELAY_MS = 250;
const FULL_REDISCOVERY_DAYS = 90;
export const STATE_VERSION = 3;

const DEFAULT_STATE = {
  version: STATE_VERSION,
  countries: {},
  nextCountryIndex: 0,
  nextDeltaCountryIndex: 0,
  nextRefreshCountryIndex: 0,
  nextRediscoveryCountryIndex: 0,
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  stats: {
    searchRequests: 0,
    enrichmentRequests: 0,
    usersDiscovered: 0,
    usersEnriched: 0,
    usersRefreshed: 0,
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
  const cacheIndex = buildCacheIndex(caches);
  const contributionWindow = rollingContributionWindow(now);
  let requests = 0;
  let discoveryRequests = 0;
  let refreshRequests = 0;
  let discoveryTurns = 0;
  state.lastRunStartedAt = now.toISOString();

  while (requests < maxQueries) {
    if (refreshRequests < discoveryRequests) {
      const refreshState = selectNextRefreshCountry(state, countries, caches);
      if (refreshState) {
        const used = await refreshCountryUsers({
          state, countryState: refreshState, countries, caches, cacheIndex,
          client, contributionWindow, sleep, dryRun
        });
        requests += used;
        refreshRequests += used;
        if (!used) break;
        await sleep(ENRICH_DELAY_MS);
        continue;
      }
    }

    const countryState = selectNextCountry(state, countries, { preferDelta: ++discoveryTurns % 4 === 0 });
    if (!countryState) {
      const refreshState = selectNextRefreshCountry(state, countries, caches);
      if (!refreshState) break;
      const used = await refreshCountryUsers({
        state,
        countryState: refreshState,
        countries,
        caches,
        cacheIndex,
        client,
        contributionWindow,
        sleep,
        dryRun
      });
      requests += used;
      refreshRequests += used;
      if (!used) break;
      await sleep(ENRICH_DELAY_MS);
      continue;
    }

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
      if (shouldSplitAfterFailure(error)) {
        countryState.queue.unshift(...splitTask(task));
        await persist(state, caches, dryRun);
        continue;
      }
      if (!isRetryableApiError(error)) {
        countryState.queue.unshift({ ...task, page });
        markFailed(countryState, error);
        await persist(state, caches, dryRun);
        throw error;
      }
      countryState.queue.unshift({ ...task, page });
      await persist(state, caches, dryRun);
      break;
    }

    requests += 1;
    discoveryRequests += 1;
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
      discoveryRequests += 1;
      state.stats.enrichmentRequests += 1;
      countryState.stats.enrichmentRequests += 1;
      enriched.push(...response.users);
      await sleep(ENRICH_DELAY_MS);
    }

    const changedCaches = mergeUsers(caches, cacheIndex, countries, enriched);
    noteCacheChanges(state, changedCaches);
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
    await persist(state, caches, dryRun, changedCaches);
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
  const cutoff = previousDate(formatDate(monthsAgo(now, 3)));
  const normalized = {
    ...DEFAULT_STATE,
    ...state,
    version: STATE_VERSION,
    countries: {},
    stats: {
      ...DEFAULT_STATE.stats,
      ...(state.stats ?? {})
    }
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
    const countryState = normalized.countries[country.slug];
    countryState.lastCacheChangeAt ??= state.lastRunFinishedAt ?? countryState.lastDiscoveryCompletedAt;
    countryState.discoveryQueuedThrough = state.countries?.[country.slug]?.discoveryQueuedThrough ?? latestQueuedDate(countryState)
      ?? previousDate(formatDate(monthsAgo(new Date(state.lastRunStartedAt ?? now), 3)));
    if (isBaselineComplete(countryState) && countryState.discoveryQueuedThrough < cutoff) {
      countryState.queue.push(...buildCountryQueue(country, nextDate(countryState.discoveryQueuedThrough), cutoff));
      countryState.discoveryQueuedThrough = cutoff;
      if (countryState.status === "complete" && countryState.queue.length) countryState.status = "discovering";
    }
  }

  queueFullRediscovery(normalized, countries, now, cutoff);

  return normalized;
}

function createCountryState(country, cutoff) {
  return {
    slug: country.slug,
    status: "pending",
    queue: buildCountryQueue(country, FIRST_GITHUB_USER_DATE, cutoff),
    completed: {},
    lastDiscoveryAt: null,
    lastDiscoveryCompletedAt: null,
    discoveryQueuedThrough: cutoff,
    lastCacheChangeAt: null,
    lastFullDiscoveryAt: null,
    fullRediscoveryActive: false,
    lastContributionRefreshAt: null,
    lastError: null,
    stats: {
      searchRequests: 0,
      enrichmentRequests: 0,
      usersDiscovered: 0,
      usersEnriched: 0,
      usersRefreshed: 0,
      usersKept: 0
    }
  };
}

function buildCountryQueue(country, start, end) {
  const terms = buildTerms([country])
    .filter((term) => term.term.trim().length > 2)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
      return a.country.localeCompare(b.country) || a.term.localeCompare(b.term);
    });
  return dateRanges(start, end).flatMap((range) =>
    terms.map((term) => ({ ...term, ...range }))
  );
}

function latestQueuedDate(countryState) {
  let latest = null;
  for (const task of countryState.queue) {
    if (task.createdEnd > (latest ?? "")) latest = task.createdEnd;
  }
  for (const key of Object.keys(countryState.completed)) {
    const date = key.split("|")[4];
    if (date > (latest ?? "")) latest = date;
  }
  return latest;
}

function queueFullRediscovery(state, countries, now, cutoff) {
  if (!countries.every((country) => isBaselineComplete(state.countries[country.slug]))) return;
  if (countries.some((country) => state.countries[country.slug].fullRediscoveryActive)) return;

  for (let offset = 0; offset < countries.length; offset += 1) {
    const index = ((state.nextRediscoveryCountryIndex ?? 0) + offset) % countries.length;
    const country = countries[index];
    const entry = state.countries[country.slug];
    const lastFull = entry.lastFullDiscoveryAt ?? entry.lastDiscoveryCompletedAt;
    if (!lastFull || now.getTime() - Date.parse(lastFull) < FULL_REDISCOVERY_DAYS * 86400000) continue;

    entry.queue = buildCountryQueue(country, FIRST_GITHUB_USER_DATE, cutoff);
    entry.completed = {};
    entry.discoveryQueuedThrough = cutoff;
    entry.fullRediscoveryActive = true;
    entry.status = "discovering";
    state.nextRediscoveryCountryIndex = (index + 1) % countries.length;
    break;
  }
}

export function selectNextCountry(state, countries, { preferDelta = false } = {}) {
  const georgia = state.countries.georgia;
  if (!georgia?.lastDiscoveryCompletedAt && georgia?.status !== "complete" && georgia?.queue?.length) return georgia;

  return selectRotatingCountry(state, countries, preferDelta)
    ?? selectRotatingCountry(state, countries, !preferDelta);
}

function selectRotatingCountry(state, countries, delta) {
  const rotating = countries
    .map((country) => country.slug)
    .filter((slug) => delta || slug !== "georgia");
  const cursor = delta ? "nextDeltaCountryIndex" : "nextCountryIndex";

  for (let offset = 0; offset < rotating.length; offset += 1) {
    const index = ((state[cursor] ?? 0) + offset) % rotating.length;
    const countryState = state.countries[rotating[index]];
    if (countryState?.queue?.length && isBaselineComplete(countryState) === delta) {
      state[cursor] = (index + 1) % rotating.length;
      return countryState;
    }
  }

  return null;
}

function selectNextRefreshCountry(state, countries, caches) {
  state.nextRefreshCountryIndex ??= 0;

  for (let offset = 0; offset < countries.length; offset += 1) {
    const index = (state.nextRefreshCountryIndex + offset) % countries.length;
    const slug = countries[index].slug;
    const countryState = state.countries[slug];
    const users = caches[slug] ?? [];
    if (isBaselineComplete(countryState) && users.length) {
      state.nextRefreshCountryIndex = (index + 1) % countries.length;
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

function mergeUsers(caches, cacheIndex, countries, users) {
  const changed = new Set();
  for (const user of users) upsertUser(caches, cacheIndex, countries, user, changed);
  return changed;
}

function buildCacheIndex(caches) {
  const index = new Map();
  for (const [slug, users] of Object.entries(caches)) {
    users.forEach((user, position) => index.set(user.login.toLowerCase(), { slug, position }));
  }
  return index;
}

function removeCachedUser(caches, cacheIndex, login, changed) {
  const key = login.toLowerCase();
  const old = cacheIndex.get(key);
  if (!old) return;
  const users = caches[old.slug];
  users.splice(old.position, 1);
  cacheIndex.delete(key);
  for (let position = old.position; position < users.length; position += 1) {
    cacheIndex.set(users[position].login.toLowerCase(), { slug: old.slug, position });
  }
  changed.add(old.slug);
}

function upsertUser(caches, cacheIndex, countries, user, changed) {
  const key = user.login.toLowerCase();
  const slug = user.followers >= 1 ? classifyLocation(user.location, countries) : null;
  const old = cacheIndex.get(key);
  if (old?.slug === slug) {
    caches[slug][old.position] = user;
    changed.add(slug);
    return;
  }
  if (old) removeCachedUser(caches, cacheIndex, user.login, changed);
  if (!slug) return;
  const position = caches[slug].length;
  caches[slug].push(user);
  cacheIndex.set(key, { slug, position });
  changed.add(slug);
}

async function refreshCountryUsers({
  state,
  countryState,
  countries,
  caches,
  cacheIndex,
  client,
  contributionWindow,
  sleep,
  dryRun
}) {
  const users = caches[countryState.slug] ?? [];
  const cursor = Math.min(countryState.refreshCursor ?? 0, users.length);
  const batch = users.slice(cursor, cursor + ENRICH_BATCH_SIZE);
  if (!batch.length) {
    finishRefresh(countryState);
    await persist(state, caches, dryRun);
    return 0;
  }

  countryState.status = "refreshing";
  console.log(`Refreshing ${countryState.slug} users ${cursor + 1}-${cursor + batch.length} of ${users.length}`);

  let response;
  try {
    response = await requestWithBackoff(() =>
      client.enrichUsers({ logins: batch.map((user) => user.login), contributionWindow }), sleep);
  } catch (error) {
    if (!isRetryableApiError(error)) {
      markFailed(countryState, error);
      await persist(state, caches, dryRun);
      throw error;
    }
    countryState.lastError = {
      message: error.message,
      status: error.status ?? null,
      at: new Date().toISOString()
    };
    await persist(state, caches, dryRun);
    return 0;
  }

  const changedCaches = replaceRefreshedUsers(caches, cacheIndex, countries, batch, response.users);
  noteCacheChanges(state, changedCaches);
  state.stats.enrichmentRequests += 1;
  state.stats.usersEnriched += response.users.length;
  state.stats.usersRefreshed += response.users.length;
  state.stats.usersKept = Object.values(caches).reduce((total, list) => total + list.length, 0);
  countryState.stats.enrichmentRequests += 1;
  countryState.stats.usersEnriched += response.users.length;
  countryState.stats.usersRefreshed += response.users.length;
  countryState.stats.usersKept = caches[countryState.slug]?.length ?? 0;
  countryState.lastError = null;
  const removed = batch.filter((user) => cacheIndex.get(user.login.toLowerCase())?.slug !== countryState.slug).length;
  countryState.refreshCursor = cursor + batch.length - removed;

  if (countryState.refreshCursor >= users.length) {
    finishRefresh(countryState);
  }

  await persist(state, caches, dryRun, changedCaches);
  return 1;
}

function replaceRefreshedUsers(caches, cacheIndex, countries, batch, users) {
  const changed = mergeUsers(caches, cacheIndex, countries, users);
  const returned = new Set(users.map((user) => user.login.toLowerCase()));
  for (const user of batch) {
    if (!returned.has(user.login.toLowerCase())) {
      removeCachedUser(caches, cacheIndex, user.login, changed);
    }
  }
  return changed;
}

function noteCacheChanges(state, changed) {
  const changedAt = new Date().toISOString();
  for (const slug of changed) state.countries[slug].lastCacheChangeAt = changedAt;
}

function markCompleteIfDone(countryState) {
  if (!countryState.queue.length && countryState.status !== "complete" && countryState.status !== "refreshing") {
    countryState.status = "complete";
    countryState.lastDiscoveryCompletedAt = new Date().toISOString();
    if (countryState.fullRediscoveryActive) {
      countryState.lastFullDiscoveryAt = countryState.lastDiscoveryCompletedAt;
      countryState.fullRediscoveryActive = false;
    }
    countryState.lastError = null;
  }
}

function finishRefresh(countryState) {
  countryState.status = countryState.queue.length ? "discovering" : "complete";
  countryState.refreshCursor = 0;
  countryState.lastContributionRefreshAt = new Date().toISOString();
  countryState.lastError = null;
}

function isBaselineComplete(countryState) {
  return Boolean(countryState?.lastDiscoveryCompletedAt || countryState?.status === "complete" || countryState?.status === "refreshing");
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
  return error.timeout || error.resourceLimit;
}

function isRetryableApiError(error) {
  return Boolean(
    error.network ||
    error.timeout ||
    error.resourceLimit ||
    error.status === 403 ||
    error.status === 429 ||
    (error.status >= 500 && error.status < 600)
  );
}

async function persist(state, caches, dryRun, changedCaches = []) {
  if (dryRun) return;
  for (const slug of changedCaches) {
    await writeJson(`${CACHE_DIR}/${slug}.json`, caches[slug]);
  }
  await writeJson(STATE_PATH, state);
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
