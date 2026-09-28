import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, monthsAgo } from "../src/lib/dates.js";

test("three-month cutoff clamps to the last day of a shorter month", () => {
  assert.equal(formatDate(monthsAgo(new Date("2026-05-31T12:00:00Z"), 3)), "2026-02-28");
  assert.equal(formatDate(monthsAgo(new Date("2024-05-31T12:00:00Z"), 3)), "2024-02-29");
});
