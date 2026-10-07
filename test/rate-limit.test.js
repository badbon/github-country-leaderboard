import test from "node:test";
import assert from "node:assert/strict";
import { waitForRateLimit } from "../src/lib/rate-limit.js";

test("server errors do not wait for an unrelated rate-limit reset", async () => {
  const delays = [];
  const waited = await waitForRateLimit({ status: 504, reset: Date.now() / 1000 + 3600 },
    async (delay) => delays.push(delay));
  assert.equal(waited, false);
  assert.deepEqual(delays, []);
});

test("throttling errors still honor reset and Retry-After", async () => {
  for (const error of [
    { status: 403, reset: Date.now() / 1000 + 60 },
    { status: 429, reset: Date.now() / 1000 + 60 },
    { status: 503, retryAfter: 10 },
    { rateLimit: { remaining: 0, resetAt: new Date(Date.now() + 60000).toISOString() } }
  ]) {
    const delays = [];
    assert.equal(await waitForRateLimit(error, async (delay) => delays.push(delay)), true);
    assert.equal(delays.length, 1);
    assert.ok(delays[0] > 0);
    if (error.retryAfter) assert.equal(delays[0], 10000);
  }
});
