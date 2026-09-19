import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixedWindowRateLimiter } from "../src/lib/fixed-window-rate-limit";

test("fixed-window limiter is keyed, bounded, and reports retry timing", () => {
  const limiter = createFixedWindowRateLimiter(2, 60_000, 2);
  assert.equal(limiter.consume("a", 1_000).allowed, true);
  assert.equal(limiter.consume("a", 1_000).allowed, true);
  assert.deepEqual(limiter.consume("a", 1_000), { allowed: false, retryAfterSeconds: 60 });
  assert.equal(limiter.consume("b", 1_000).allowed, true);
  assert.equal(limiter.consume("c", 1_000).allowed, true);
  assert.equal(limiter.blocked("a", 1_000).allowed, true, "oldest bucket is evicted at the cap");
  assert.equal(limiter.consume("a", 61_000).allowed, true);
});
