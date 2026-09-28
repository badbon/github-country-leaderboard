import test from "node:test";
import assert from "node:assert/strict";
import { sortForCategory } from "../src/lib/ranking.js";

test("sorts each category descending", () => {
  const users = [
    { login: "low", followers: 5, publicContributions: 20, privateContributions: 0 },
    { login: "high", followers: 2, publicContributions: 1, privateContributions: 30 }
  ];

  assert.equal(sortForCategory(users, "followers")[0].login, "low");
  assert.equal(sortForCategory(users, "publicContributions")[0].login, "low");
  assert.equal(sortForCategory(users, "totalContributions")[0].login, "high");
});
