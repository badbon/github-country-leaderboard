import test from "node:test";
import assert from "node:assert/strict";
import { renderLeaderboard } from "../src/lib/render.js";

test("renders reference-style markdown table", () => {
  const markdown = renderLeaderboard({
    country: { name: "Bulgaria" },
    category: "publicContributions",
    generatedAt: "2026-08-13T00:00:00.000Z",
    users: [
      {
        login: "dev",
        name: "Dev",
        company: "Example",
        twitterUsername: "dev",
        location: "Sofia, Bulgaria",
        followers: 3,
        publicContributions: 55,
        privateContributions: 1
      }
    ]
  });

  assert.match(markdown, /^# Public Contributions - Bulgaria/m);
  assert.match(markdown, /\| # \| User \| Name \| Company \| Twitter \| Location \| Public Contributions \|/);
  assert.match(markdown, /\| 1 \| \[dev\]\(https:\/\/github.com\/dev\)/);
});

test("renders at most 20 leaderboard rows", () => {
  const markdown = renderLeaderboard({
    country: { name: "Georgia" },
    category: "publicContributions",
    generatedAt: "2026-08-13T00:00:00.000Z",
    users: Array.from({ length: 25 }, (_, index) => ({
      login: `dev-${index}`,
      name: "",
      company: "",
      twitterUsername: "",
      location: "Tbilisi, Georgia",
      followers: 1,
      publicContributions: 25 - index,
      privateContributions: 0
    }))
  });

  assert.equal(markdown.split("\n").filter((line) => /^\| \d+ \|/.test(line)).length, 20);
  assert.doesNotMatch(markdown, /^\| 21 \|/m);
});
