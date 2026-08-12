import test from "node:test";
import assert from "node:assert/strict";
import { dedupeUsers, sortForCategory } from "../src/lib/ranking.js";

test("dedupes users by login and keeps stronger record", () => {
  const users = dedupeUsers([
    { login: "A", followers: 1, publicContributions: 1, privateContributions: 0 },
    { login: "a", followers: 10, publicContributions: 5, privateContributions: 0 }
  ]);

  assert.equal(users.length, 1);
  assert.equal(users[0].followers, 10);
});

test("sorts each category descending", () => {
  const users = [
    { login: "low", followers: 5, publicContributions: 20, privateContributions: 0 },
    { login: "high", followers: 2, publicContributions: 1, privateContributions: 30 }
  ];

  assert.equal(sortForCategory(users, "followers")[0].login, "low");
  assert.equal(sortForCategory(users, "publicContributions")[0].login, "low");
  assert.equal(sortForCategory(users, "totalContributions")[0].login, "high");
});
