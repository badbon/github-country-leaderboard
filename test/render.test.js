import test from "node:test";
import assert from "node:assert/strict";
import { renderCountryHub, renderLeaderboard, renderReadme } from "../src/lib/render.js";

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

test("renders five deterministic daily countries", () => {
  const countries = Array.from({ length: 10 }, (_, index) => ({
    slug: `country_${index}`,
    name: `Country ${index}`,
    userCount: index
  }));

  const first = renderReadme({ countries, generatedAt: "2026-09-02T10:00:00.000Z" });
  const second = renderReadme({ countries, generatedAt: "2026-09-02T23:00:00.000Z" });
  const nextDay = renderReadme({ countries, generatedAt: "2026-09-03T00:00:00.000Z" });

  assert.equal(countryRows(first).length, 5);
  assert.deepEqual(countryRows(first), countryRows(second));
  assert.notDeepEqual(countryRows(first), countryRows(nextDay));
});

test("country hub uses category metric names instead of generic value", () => {
  const markdown = renderCountryHub({
    country: { slug: "georgia", name: "Georgia" },
    generatedAt: "2026-09-02T00:00:00.000Z",
    users: [{
      login: "dev",
      name: "Dev",
      location: "Tbilisi",
      followers: 3,
      publicContributions: 55,
      privateContributions: 1
    }]
  });

  assert.match(markdown, /\| # \| User \| Name \| Location \| Public Contributions \|/);
  assert.match(markdown, /\| # \| User \| Name \| Location \| Total Contributions \|/);
  assert.match(markdown, /\| # \| User \| Name \| Location \| Followers \|/);
  assert.doesNotMatch(markdown, /\| # \| User \| Name \| Location \| Value \|/);
  assert.ok(markdown.indexOf("## Total Contributions") < markdown.indexOf("## Public Contributions"));
  assert.ok(markdown.indexOf("| Total Contributions | [Open]") < markdown.indexOf("| Public Contributions | [Open]"));
});

function countryRows(markdown) {
  return markdown.split("\n").filter((line) => line.startsWith("| [Country "));
}
