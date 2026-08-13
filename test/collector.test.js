import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, createInitialState, selectNextCountry } from "../src/lib/collector.js";
import { readJson, writeJson } from "../src/lib/storage.js";
import { normalizeCountry } from "../src/lib/locations.js";

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
