import test from "node:test";
import assert from "node:assert/strict";
import { buildTerms, normalizeCountry } from "../src/lib/locations.js";

test("dedupes country terms case-insensitively", () => {
  const countries = [
    normalizeCountry({
      slug: "australia",
      name: "Australia",
      iso2: "AU",
      aliases: ["australia", "AUSTRALIA"],
      cities: ["Sydney", "sydney"],
      overrides: []
    })
  ];

  const terms = buildTerms(countries);
  assert.deepEqual(terms.map((term) => `${term.kind}:${term.term}`), [
    "country:Australia",
    "city:Sydney"
  ]);
});
