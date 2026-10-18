import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { getDb } from "../src/lib/db";

const vault = mkdtempSync(join(tmpdir(), "chibako-auth-limit-test-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => {
  getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

test("auth attempt limits are per client, bounded, and expire", async () => {
  const limiter = await import("../src/lib/auth-rate-limit");
  limiter.resetAuthAttemptLimiter();
  const previousTrust = process.env.CHIBAKO_TRUST_PROXY;
  delete process.env.CHIBAKO_TRUST_PROXY;
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
    const forged = new Request("http://localhost", { headers: { "X-Chibako-Client-IP": clientA } });
    assert.equal(limiter.getAuthClientId(forged), "direct", "client headers are ignored by default");
    process.env.CHIBAKO_TRUST_PROXY = "true";
    assert.equal(
      limiter.getAuthClientId(new Request("http://localhost", {
        headers: { "X-Chibako-Client-IP": clientA, "X-Forwarded-For": "203.0.113.9" },
      })),
      clientA,
    );

    limiter.resetAuthAttemptLimiter();
    for (let i = 0; i < 5; i += 1) limiter.consumeAuthAttempt(clientA, start);
    assert.equal(limiter.consumeAuthAttempt(clientA, start).allowed, false);
    const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", `
      import { consumeAuthAttempt } from "./src/lib/auth-rate-limit.ts";
      if (consumeAuthAttempt("198.51.100.1", 1000000).allowed) process.exit(1);
    `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CHIBAKO_DATA_DIR: vault }, timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr?.toString());
    for (let i = 0; i < 45; i += 1) {
      assert.equal(limiter.consumeAuthAttempt(`client-${i}`, start).allowed, true);
    }
    assert.equal(limiter.consumeAuthAttempt("new-client", start).allowed, false, "rotating clients cannot bypass the vault limit");
    assert.equal(limiter.consumeAuthAttempt(clientA, start).allowed, false, "client bucket is never evicted");
    const rows = getDb().prepare("SELECT bucket FROM auth_attempts").all() as { bucket: string }[];
    assert.equal(rows.length, 47, "global limit bounds stored client rows");
    assert.ok(rows.every(row => !row.bucket.includes(clientA)), "raw client addresses are not persisted");
    assert.equal(limiter.consumeAuthAttempt("new-client", start + 60_000).allowed, true);
  } finally {
    limiter.resetAuthAttemptLimiter();
    if (previousTrust === undefined) delete process.env.CHIBAKO_TRUST_PROXY;
    else process.env.CHIBAKO_TRUST_PROXY = previousTrust;
  }
});

test("both auth entry points apply the limiter before expensive work", async () => {
  const limiter = await import("../src/lib/auth-rate-limit");
  const { hashPassword } = await import("../src/server/auth/password-authentication");
  const { getDb } = await import("../src/lib/db");
  const { POST } = await import("../src/app/api/login/route");
  const { POST: setup } = await import("../src/app/api/setup/route");
  limiter.resetAuthAttemptLimiter();
  process.env.CHIBAKO_TRUST_PROXY = "true";
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
    limiter.resetAuthAttemptLimiter();
    delete process.env.CHIBAKO_TRUST_PROXY;
  }
});
