import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient } from "../src/lib/github.js";

const contributionWindow = { from: "2025-10-07T00:00:00Z", to: "2026-10-07T00:00:00Z" };

function responseClient(body) {
  return new GitHubClient({ token: "test-token", fetchImpl: async () => ({
    ok: true, headers: { get: () => null }, json: async () => body
  }) });
}

test("missing accounts do not discard valid users in the same batch", async () => {
  const rateLimit = { remaining: 100 };
  const client = responseClient({
    data: { u0: null, u1: { login: "valid", followers: { totalCount: 3 } }, rateLimit },
    errors: [{ type: "NOT_FOUND", path: ["u0"], message: "Missing user" }]
  });
  const result = await client.enrichUsers({ logins: ["deleted", "valid"], contributionWindow });
  assert.deepEqual(result.users.map((user) => user.login), ["valid"]);
  assert.equal(result.rateLimit, rateLimit);
});

test("missing-only batches return no users", async () => {
  const client = responseClient({ data: { u0: null }, errors: [
    { type: "NOT_FOUND", path: ["u0"], message: "Missing user" }
  ] });
  assert.deepEqual((await client.enrichUsers({ logins: ["deleted"], contributionWindow })).users, []);
});

test("other GraphQL failures remain fatal rather than deleting cached users", async () => {
  for (const error of [
    { type: "INTERNAL", path: ["u0"], message: "Internal failure" },
    { type: "NOT_FOUND", path: ["u0", "contributionsCollection"], message: "Field failure" },
    { type: "NOT_FOUND", path: ["unknown"], message: "Unknown failure" }
  ]) {
    const client = responseClient({ data: { u0: null }, errors: [error] });
    await assert.rejects(() => client.enrichUsers({ logins: ["valid"], contributionWindow }), new RegExp(error.message));
  }
});

test("incomplete GraphQL batches cannot masquerade as removed accounts", async () => {
  for (const data of [null, {}, { u0: { login: "valid" } }]) {
    const client = responseClient({ data });
    await assert.rejects(() => client.enrichUsers({ logins: ["valid", "other"], contributionWindow }), /incomplete user batch/);
  }
});

test("marks closed socket fetch failures as retryable network errors", async () => {
  const client = new GitHubClient({
    token: "test-token",
    async fetchImpl() {
      throw Object.assign(new TypeError("terminated"), {
        cause: { code: "UND_ERR_SOCKET" }
      });
    }
  });

  await assert.rejects(
    () => client.requestJson("https://example.test", { method: "GET" }),
    (error) => error.network === true
  );
});

test("marks closed socket response streams as retryable network errors", async () => {
  const client = new GitHubClient({
    token: "test-token",
    async fetchImpl() {
      return {
        ok: true,
        headers: { get: () => null },
        async json() {
          throw Object.assign(new TypeError("terminated"), {
            cause: { code: "UND_ERR_SOCKET" }
          });
        }
      };
    }
  });

  await assert.rejects(
    () => client.requestJson("https://example.test", { method: "GET" }),
    (error) => error.network === true
  );
});

test("marks truncated JSON response streams as retryable network errors", async () => {
  const client = new GitHubClient({
    token: "test-token",
    async fetchImpl() {
      return {
        ok: true,
        headers: { get: () => null },
        async json() {
          throw new SyntaxError("Unexpected end of JSON input");
        }
      };
    }
  });

  await assert.rejects(
    () => client.requestJson("https://example.test", { method: "GET" }),
    (error) => error.network === true
  );
});
