import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("auth attempt limit expires and does not use request identity", async () => {
  const limiter = await import("../src/lib/auth-rate-limit");
  limiter.resetAuthAttemptLimiter();
  try {
    const start = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(limiter.consumeAuthAttempt(start), { allowed: true, retryAfterSeconds: 0 });
    }
    assert.deepEqual(limiter.consumeAuthAttempt(start), { allowed: false, retryAfterSeconds: 60 });
    assert.deepEqual(limiter.consumeAuthAttempt(start + 1_000), { allowed: false, retryAfterSeconds: 59 });
    assert.deepEqual(limiter.consumeAuthAttempt(start + 60_000), { allowed: true, retryAfterSeconds: 0 });
  } finally {
    limiter.resetAuthAttemptLimiter();
  }
});

test("both auth entry points apply the limiter before expensive work", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-auth-limit-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const limiter = await import("../src/lib/auth-rate-limit");
  const { hashPassword } = await import("../src/lib/auth");
  const { getDb } = await import("../src/lib/db");
  const { POST } = await import("../src/app/api/login/route");
  const { POST: setup } = await import("../src/app/api/setup/route");
  limiter.resetAuthAttemptLimiter();
  try {
    const setupRequest = (forwardedFor: string) => new Request("http://localhost/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": forwardedFor },
      body: JSON.stringify({ password: "short" }),
    });
    for (let i = 0; i < 5; i += 1) assert.equal((await setup(setupRequest(`198.51.100.${i + 1}`))).status, 400);
    const setupLimited = await setup(setupRequest("198.51.100.99"));
    assert.equal(setupLimited.status, 429);
    assert.equal(setupLimited.headers.get("Retry-After"), "60");

    limiter.resetAuthAttemptLimiter();
    getDb().prepare("INSERT INTO settings (key, value) VALUES ('password_hash', ?)").run(hashPassword("correct-password"));
    const loginRequest = (forwardedFor: string) => new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": forwardedFor },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    for (let i = 0; i < 5; i += 1) assert.equal((await POST(loginRequest(`203.0.113.${i + 1}`))).status, 401);
    const loginLimited = await POST(loginRequest("203.0.113.99"));
    assert.equal(loginLimited.status, 429);
    assert.equal(loginLimited.headers.get("Retry-After"), "60");
    assert.match((await loginLimited.json()).error, /try again in 60 seconds/i);
  } finally {
    getDb().close();
    limiter.resetAuthAttemptLimiter();
    rmSync(vault, { recursive: true, force: true });
  }
});
