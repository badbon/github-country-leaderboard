import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect } from "../src/lib/collector.js";

test("requeues the same page when request budget ends mid-enrichment", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-collector-"));
  process.chdir(tempDir);

  try {
    const countries = [{
      slug: "testland",
      name: "Testland",
      iso2: "TL",
      aliases: ["Testland"],
      cities: [],
      overrides: [],
      normalizedAliases: ["testland"],
      normalizedCities: [],
      normalizedOverrides: []
    }];

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
    assert.equal(result.state.queue[0].page, 1);
    assert.equal(Object.keys(result.state.completed).length, 0);
    assert.equal(result.state.stats.usersEnriched, 20);
    assert.equal(result.state.stats.usersKept, 20);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});
