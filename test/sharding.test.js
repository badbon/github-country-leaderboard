import test from "node:test";
import assert from "node:assert/strict";
import { splitTask } from "../src/lib/sharding.js";

test("splits broad over-cap shards by created date first", () => {
  const parts = splitTask({
    country: "united_states",
    kind: "country",
    term: "United States",
    createdStart: "2008-01-01",
    createdEnd: "2026-05-13"
  });

  assert.equal(parts.length, 2);
  assert.equal(parts[0].createdStart, "2008-01-01");
  assert.ok(parts[0].createdEnd < parts[1].createdStart);
});

test("splits same-day over-cap shards by followers", () => {
  const parts = splitTask({
    country: "united_states",
    kind: "country",
    term: "United States",
    createdStart: "2020-01-01",
    createdEnd: "2020-01-01"
  });

  assert.deepEqual(parts.map((part) => [part.followersMin, part.followersMax]), [[1, 1000], [1001, null]]);
});

test("splits finite follower ranges until exact values remain", () => {
  const parts = splitTask({
    country: "united_states",
    kind: "country",
    term: "United States",
    createdStart: "2020-01-01",
    createdEnd: "2020-01-01",
    followersMin: 1,
    followersMax: 10
  });

  assert.deepEqual(parts.map((part) => [part.followersMin, part.followersMax]), [[1, 5], [6, 10]]);
});
