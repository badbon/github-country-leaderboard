import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchQuery } from "../src/lib/query.js";

test("discovery queries keep followers one-or-more filter", () => {
  const query = buildSearchQuery({
    country: "georgia",
    kind: "country",
    term: "Georgia",
    createdStart: "2008-01-01",
    createdEnd: "2026-05-12"
  });

  assert.match(query, /type:user/);
  assert.match(query, /followers:>=1/);
  assert.match(query, /location:"Georgia"/);
});
