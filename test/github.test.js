import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient } from "../src/lib/github.js";

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
