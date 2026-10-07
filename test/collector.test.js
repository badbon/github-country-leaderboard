import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, createInitialState, selectNextCountry } from "../src/lib/collector.js";
import { readJson, writeJson } from "../src/lib/storage.js";
import { normalizeCountry } from "../src/lib/locations.js";

test("fatal search failures preserve the unfinished discovery task", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-failed-search-"));
  process.chdir(tempDir);
  try {
    const countries = testCountries(["testland"]);
    const initial = createInitialState(countries, new Date("2026-08-13T00:00:00Z"));
    await assert.rejects(() => collect({
      countries,
      client: { searchUsers: async () => { throw new Error("Invalid search"); } },
      maxQueries: 1,
      now: new Date("2026-08-13T00:00:00Z"),
      sleep: async () => {}
    }), /Invalid search/);
    const saved = await readJson("data/state.json");
    assert.equal(saved.countries.testland.status, "failed");
    assert.equal(saved.countries.testland.queue.length, initial.countries.testland.queue.length);
    assert.deepEqual(saved.countries.testland.queue[0], { ...initial.countries.testland.queue[0], page: 1 });
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("schedules Georgia first from clean state", () => {
  const countries = testCountries(["united_states", "georgia", "france"]);
  const state = createInitialState(countries, new Date("2026-08-13T00:00:00Z"));

  assert.equal(selectNextCountry(state, countries).slug, "georgia");
});

test("rotates countries fairly after Georgia completes", () => {
  const countries = testCountries(["georgia", "alpha", "beta"]);
  const state = createInitialState(countries, new Date("2026-08-13T00:00:00Z"));
  state.countries.georgia.status = "complete";
  state.countries.georgia.queue = [];

  assert.equal(selectNextCountry(state, countries).slug, "alpha");
  assert.equal(selectNextCountry(state, countries).slug, "beta");
  assert.equal(selectNextCountry(state, countries).slug, "alpha");
});

test("keeps baseline discovery ahead of daily discovery", () => {
  const countries = testCountries(["georgia", "alpha", "beta", "gamma"]);
  const state = createInitialState(countries, new Date("2026-08-13T00:00:00Z"));
  state.countries.georgia.status = "complete";
  state.countries.georgia.queue = [];
  state.countries.georgia.lastDiscoveryCompletedAt = "2026-08-13T00:00:00Z";
  state.countries.gamma.lastDiscoveryCompletedAt = "2026-08-13T00:00:00Z";

  assert.equal(selectNextCountry(state, countries).slug, "alpha");
  assert.equal(selectNextCountry(state, countries).slug, "beta");
  assert.equal(selectNextCountry(state, countries).slug, "alpha");
  assert.equal(selectNextCountry(state, countries, { preferDelta: true }).slug, "gamma");
});

test("requeues the same page when request budget ends mid-enrichment", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-collector-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["testland"]);

    const client = {
      async searchUsers() {
        return {
          total: 25,
          incomplete: false,
          users: Array.from({ length: 25 }, (_, index) => ({ login: `user-${index}` })),
          rateLimit: { remaining: 20 }
        };
      },
      async enrichUsers({ logins }) {
        return {
          users: logins.map((login) => ({
            login,
            name: login,
            avatarUrl: "",
            location: "Testland",
            company: "",
            twitterUsername: "",
            followers: 1,
            privateContributions: 0,
            publicContributions: 1,
            createdAt: "2020-01-01T00:00:00Z"
          })),
          rateLimit: { remaining: 20 }
        };
      }
    };

    const result = await collect({
      countries,
      client,
      maxQueries: 2,
      now: new Date("2026-08-13T00:00:00Z"),
      sleep: async () => {}
    });

    assert.equal(result.queries, 2);
    assert.equal(result.state.countries.testland.queue[0].page, 1);
    assert.equal(Object.keys(result.state.countries.testland.completed).length, 0);
    assert.equal(result.state.stats.usersEnriched, 20);
    assert.equal(result.state.stats.usersKept, 20);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("requeues the same page when enrichment has transient GitHub failures", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-collector-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["testland"]);
    let enrichCalls = 0;

    const client = {
      async searchUsers() {
        return {
          total: 1,
          incomplete: false,
          users: [{ login: "retry-me" }],
          rateLimit: { remaining: 20 }
        };
      },
      async enrichUsers() {
        enrichCalls += 1;
        throw Object.assign(new Error("GitHub API request failed: 504"), { status: 504 });
      }
    };

    const result = await collect({
      countries,
      client,
      maxQueries: 2,
      now: new Date("2026-08-13T00:00:00Z"),
      sleep: async () => {}
    });

    assert.ok(enrichCalls > 0);
    assert.equal(result.state.countries.testland.queue[0].page, 1);
    assert.equal(Object.keys(result.state.countries.testland.completed).length, 0);
    assert.equal(result.state.stats.usersKept, 0);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("stops cleanly and requeues when search has transient network failures", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-collector-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["testland"]);
    const client = {
      async searchUsers() {
        throw Object.assign(new Error("GitHub API network request failed: terminated"), { network: true });
      },
      async enrichUsers() {
        throw new Error("enrichUsers should not be called");
      }
    };

    const result = await collect({
      countries,
      client,
      maxQueries: 10,
      now: new Date("2026-08-13T00:00:00Z"),
      sleep: async () => {}
    });

    assert.equal(result.queries, 0);
    assert.equal(result.state.countries.testland.status, "discovering");
    assert.equal(result.state.countries.testland.queue[0].page, 1);
    assert.equal(result.state.countries.testland.lastError, null);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("refreshes cached users after all discovery queues complete", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-collector-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["georgia"]);
    await writeJson("data/state.json", {
      version: 3,
      countries: {
        georgia: {
          slug: "georgia",
          status: "complete",
          queue: [],
          completed: {},
          refreshCursor: 0,
          stats: {}
        }
      },
      stats: {}
    });
    await writeJson("cache/georgia.json", [{
      login: "nino",
      location: "Tbilisi, Georgia",
      followers: 1,
      publicContributions: 100,
      privateContributions: 0
    }]);

    const result = await collect({
      countries,
      client: {
        async searchUsers() {
          throw new Error("searchUsers should not be called during refresh");
        },
        async enrichUsers({ logins }) {
          assert.deepEqual(logins, ["nino"]);
          return {
            users: [{
              login: "nino",
              name: "Nino",
              avatarUrl: "",
              location: "Tbilisi, Georgia",
              company: "",
              twitterUsername: "",
              followers: 7,
              privateContributions: 2,
              publicContributions: 50,
              createdAt: "2020-01-01T00:00:00Z"
            }]
          };
        }
      },
      maxQueries: 1,
      now: new Date("2026-08-13T00:00:00Z"),
      sleep: async () => {}
    });

    const cache = await readJson("cache/georgia.json");
    assert.equal(result.queries, 1);
    assert.equal(result.state.countries.georgia.status, "complete");
    assert.equal(result.state.countries.georgia.refreshCursor, 0);
    assert.ok(result.state.countries.georgia.lastContributionRefreshAt);
    assert.equal(result.state.stats.usersRefreshed, 1);
    assert.equal(cache[0].publicContributions, 50);
    assert.equal(cache[0].privateContributions, 2);
    assert.equal(cache[0].followers, 7);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("refreshes completed countries while discovery work remains", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-collector-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["georgia", "testland"]);
    await writeJson("data/state.json", {
      version: 3,
      countries: {
        georgia: {
          slug: "georgia",
          status: "complete",
          queue: [],
          completed: {},
          refreshCursor: 0,
          stats: {}
        },
        testland: {
          slug: "testland",
          status: "discovering",
          queue: [{
            country: "testland",
            kind: "country",
            term: "Testland",
            createdStart: "2020-01-01",
            createdEnd: "2020-12-31"
          }],
          completed: {},
          stats: {}
        }
      },
      stats: {}
    });
    await writeJson("cache/georgia.json", [{
      login: "nino",
      location: "Tbilisi, Georgia",
      followers: 1,
      publicContributions: 100,
      privateContributions: 0
    }]);
    await writeJson("cache/testland.json", []);

    let searched = false;
    const result = await collect({
      countries,
      client: {
        async searchUsers() {
          searched = true;
          return { total: 0, incomplete: false, users: [] };
        },
        async enrichUsers({ logins }) {
          assert.deepEqual(logins, ["nino"]);
          return { users: [{
            login: "nino", location: "Tbilisi, Georgia", followers: 1,
            publicContributions: 50, privateContributions: 0
          }] };
        }
      },
      maxQueries: 2,
      now: new Date("2026-08-13T00:00:00Z"),
      sleep: async () => {}
    });

    const cache = await readJson("cache/georgia.json");
    assert.equal(searched, true);
    assert.equal(result.queries, 2);
    assert.equal(result.state.stats.usersRefreshed, 1);
    assert.equal(cache[0].publicContributions, 50);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("queues newly eligible dates for an already published country", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-delta-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["testland"]);
    await writeJson("data/state.json", {
      version: 3,
      countries: {
        testland: {
          status: "complete",
          queue: [],
          completed: { "testland|country|Testland|2008-01-01|2026-05-12||": {} },
          lastDiscoveryCompletedAt: "2026-08-13T00:00:00Z",
          stats: {}
        }
      },
      stats: {}
    });

    const result = await collect({
      countries, client: neverClient(), maxQueries: 0,
      now: new Date("2026-08-15T00:00:00Z"), sleep: async () => {}
    });
    const country = result.state.countries.testland;
    assert.equal(country.status, "discovering");
    assert.equal(country.discoveryQueuedThrough, "2026-05-14");
    assert.equal(country.queue[0].createdStart, "2026-05-13");
    assert.equal(country.queue[0].createdEnd, "2026-05-14");
    assert.ok(country.lastDiscoveryCompletedAt);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("starts only one full rediscovery when all baselines are complete", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-rediscovery-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["georgia", "italy"]);
    await writeJson("data/state.json", {
      version: 3,
      countries: Object.fromEntries(countries.map(({ slug }) => [slug, {
        status: "complete", queue: [], completed: {}, discoveryQueuedThrough: "2026-05-12",
        lastDiscoveryCompletedAt: "2026-08-13T00:00:00Z", stats: {}
      }])),
      stats: {}
    });

    const result = await collect({
      countries, client: neverClient(), maxQueries: 0,
      now: new Date("2026-12-01T00:00:00Z"), sleep: async () => {}
    });
    const active = countries.filter(({ slug }) => result.state.countries[slug].fullRediscoveryActive);
    assert.equal(active.length, 1);
    assert.ok(result.state.countries[active[0].slug].queue.some((task) => task.createdStart === "2008-01-01"));
    assert.ok(result.state.countries.italy.queue.length);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("refresh replaces lower counts, moves users, and removes missing accounts", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-refresh-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["georgia", "italy"]);
    const cutoff = "2026-05-12";
    await writeJson("data/state.json", {
      version: 3,
      countries: Object.fromEntries(countries.map(({ slug }) => [slug, {
        status: "complete", queue: [], completed: {}, discoveryQueuedThrough: cutoff,
        lastDiscoveryCompletedAt: "2026-08-13T00:00:00Z", stats: {}
      }])),
      stats: {}
    });
    await writeJson("cache/georgia.json", [
      { login: "move", location: "Georgia", followers: 10, publicContributions: 100 },
      { login: "stay", location: "Georgia", followers: 10, publicContributions: 100 },
      { login: "deleted", location: "Georgia", followers: 10, publicContributions: 100 }
    ]);
    await writeJson("cache/italy.json", []);

    const result = await collect({
      countries,
      client: {
        async searchUsers() { throw new Error("no discovery expected"); },
        async enrichUsers() {
          return { users: [
            { login: "move", location: "Italy", followers: 2, publicContributions: 5 },
            { login: "stay", location: "Georgia", followers: 2, publicContributions: 5 }
          ] };
        }
      },
      maxQueries: 1, now: new Date("2026-08-13T00:00:00Z"), sleep: async () => {}
    });

    const georgia = await readJson("cache/georgia.json");
    const italy = await readJson("cache/italy.json");
    assert.deepEqual(georgia.map((user) => user.login), ["stay"]);
    assert.equal(georgia[0].publicContributions, 5);
    assert.deepEqual(italy.map((user) => user.login), ["move"]);
    assert.equal(result.state.countries.georgia.status, "complete");
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("migrates v2 state to v3 country state and preserves cache users", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-collector-"));
  process.chdir(tempDir);

  try {
    const countries = testCountries(["georgia"]);
    await writeJson("data/state.json", {
      version: 2,
      queue: [{ country: "brazil" }],
      completed: {}
    });
    await writeJson("cache/georgia.json", [{
      login: "nino",
      location: "Tbilisi, Georgia",
      followers: 1,
      publicContributions: 10,
      privateContributions: 0
    }]);

    const result = await collect({
      countries,
      client: neverClient(),
      maxQueries: 0,
      now: new Date("2026-08-13T00:00:00Z"),
      sleep: async () => {}
    });

    assert.equal(result.state.version, 3);
    assert.ok(result.state.countries.georgia.queue.length > 0);
    assert.equal((await readJson("cache/georgia.json"))[0].login, "nino");
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

function testCountries(slugs) {
  return slugs.map((slug) => normalizeCountry({
    slug,
    name: slug.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    iso2: slug.slice(0, 2).toUpperCase(),
    aliases: [slug.replaceAll("_", " ")],
    cities: [],
    overrides: []
  }));
}

function neverClient() {
  return {
    async searchUsers() {
      throw new Error("searchUsers should not be called");
    },
    async enrichUsers() {
      throw new Error("enrichUsers should not be called");
    }
  };
}
