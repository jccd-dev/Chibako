import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("auth attempt limits are per client, bounded, and expire", async () => {
  const limiter = await import("../src/lib/auth-rate-limit");
  limiter.resetAuthAttemptLimiter();
  try {
    const start = 1_000_000;
    const clientA = "198.51.100.1";
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(limiter.consumeAuthAttempt(clientA, start), { allowed: true, retryAfterSeconds: 0 });
    }
    assert.deepEqual(limiter.consumeAuthAttempt(clientA, start), { allowed: false, retryAfterSeconds: 60 });
    assert.deepEqual(limiter.consumeAuthAttempt("198.51.100.2", start), { allowed: true, retryAfterSeconds: 0 });
    assert.deepEqual(limiter.consumeAuthAttempt(clientA, start + 1_000), { allowed: false, retryAfterSeconds: 59 });
    assert.deepEqual(limiter.consumeAuthAttempt(clientA, start + 60_000), { allowed: true, retryAfterSeconds: 0 });

    assert.equal(
      limiter.getAuthClientId(new Request("http://localhost", { headers: { "X-Forwarded-For": "203.0.113.9" } })),
      "direct",
    );
    assert.equal(
      limiter.getAuthClientId(new Request("http://localhost", {
        headers: { "X-Chibako-Client-IP": clientA, "X-Forwarded-For": "203.0.113.9" },
      })),
      clientA,
    );

    limiter.resetAuthAttemptLimiter();
    for (let i = 0; i < 5; i += 1) limiter.consumeAuthAttempt(clientA, start);
    assert.equal(limiter.consumeAuthAttempt(clientA, start).allowed, false);
    for (let i = 0; i < 1_024; i += 1) limiter.consumeAuthAttempt(`client-${i}`, start);
    assert.equal(limiter.consumeAuthAttempt(clientA, start).allowed, true, "oldest bucket is evicted at the cap");
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
    const clientA = "198.51.100.42";
    const clientB = "198.51.100.43";
    // Simulate nginx output: proxy-owned identity stays fixed while XFF varies.
    const setupRequest = (clientId: string, forwardedFor: string) => new Request("http://localhost/api/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chibako-Client-IP": clientId,
        "X-Forwarded-For": forwardedFor,
      },
      body: JSON.stringify({ password: "short" }),
    });
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await setup(setupRequest(clientA, `203.0.113.${i + 1}`))).status, 400);
    }
    const setupLimited = await setup(setupRequest(clientA, "203.0.113.99"));
    assert.equal(setupLimited.status, 429);
    assert.equal(setupLimited.headers.get("Retry-After"), "60");
    assert.equal((await POST(new Request("http://localhost/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chibako-Client-IP": clientA,
        "X-Forwarded-For": "198.18.0.1",
      },
      body: JSON.stringify({ password: "wrong-password" }),
    }))).status, 429, "login shares setup bucket for same client");
    assert.equal((await setup(setupRequest(clientB, "198.18.0.2"))).status, 400, "different client gets own bucket");

    limiter.resetAuthAttemptLimiter();
    getDb().prepare("INSERT INTO settings (key, value) VALUES ('password_hash', ?)").run(hashPassword("correct-password"));
    const loginRequest = (clientId: string, forwardedFor: string) => new Request("http://localhost/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chibako-Client-IP": clientId,
        "X-Forwarded-For": forwardedFor,
      },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await POST(loginRequest(clientA, `198.18.0.${i + 1}`))).status, 401);
    }
    const loginLimited = await POST(loginRequest(clientA, "198.18.0.99"));
    assert.equal(loginLimited.status, 429);
    assert.equal(loginLimited.headers.get("Retry-After"), "60");
    assert.match((await loginLimited.json()).error, /try again in 60 seconds/i);
    assert.equal((await POST(loginRequest(clientB, "198.18.0.100"))).status, 401, "different client keeps invalid-password behavior");

    const setupAlready = await setup(setupRequest(clientB, "198.18.0.101"));
    assert.equal(setupAlready.status, 400);
    assert.match((await setupAlready.json()).error, /already set up/i);
  } finally {
    getDb().close();
    limiter.resetAuthAttemptLimiter();
    rmSync(vault, { recursive: true, force: true });
  }
});
