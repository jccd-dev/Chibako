import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const password = "correct horse battery staple";
const setupToken = "test-only-setup-token-at-least-32-characters";
const nextPassword = "new correct horse battery staple";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl: string, server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next server exited with code ${server.exitCode}`);
    try {
      await fetch(`${baseUrl}/login`);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Next server did not become ready");
}

function cookieFrom(response: Response): string {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1, "successful auth response sets one session cookie");
  return cookies[0].split(";", 1)[0];
}

async function post(baseUrl: string, pathname: string, body: unknown, cookie?: string, clientId?: string): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      "X-Chibako-Client-IP": clientId ?? pathname,
    },
    body: JSON.stringify(body),
  });
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill("SIGTERM");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stopped = await Promise.race([
    exited.then(() => {
      if (timeout) clearTimeout(timeout);
      return true;
    }),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), 5_000);
    }),
  ]);
  if (stopped) return;
  server.kill("SIGKILL");
  await exited;
}

test("setup, login, password change, and session invalidation preserve route contracts", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-password-routes-"));
  // Stable path: next rewrites next-env.d.ts and tsconfig.json with the distDir it used,
  // so a per-run temp name would churn those tracked files on every test run.
  const buildDir = join(process.cwd(), ".next", "test-builds", "password-routes");
  mkdirSync(buildDir, { recursive: true });
  const updaterDir = mkdtempSync(join(tmpdir(), "chibako-updater-channel-"));
  mkdirSync(join(updaterDir, "in"));
  mkdirSync(join(updaterDir, "out"));
  const port = 3200 + (process.pid % 700);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: { ...process.env, CHIBAKO_DATA_DIR: vault, CHIBAKO_BUILD_DIR: buildDir, CHIBAKO_SETUP_TOKEN: setupToken, CHIBAKO_TRUST_PROXY: "true", CHIBAKO_UPDATER_DIR: updaterDir, CHIBAKO_VERSION: "0.1.1" },
      stdio: "ignore",
    },
  );
  let setupCookie = "";
  let loginCookie = "";
  try {
    await waitForServer(baseUrl, server);

    const short = await post(baseUrl, "/api/setup", { password: "short" });
    assert.equal(short.status, 400);
    assert.match((await short.json()).error, /at least 15/i);

    const missingToken = await post(baseUrl, "/api/setup", { password });
    assert.equal(missingToken.status, 403);
    assert.equal(missingToken.headers.get("set-cookie"), null);
    const wrongToken = await post(baseUrl, "/api/setup", { password, setupToken: "wrong" });
    assert.equal(wrongToken.status, 403);
    assert.equal(wrongToken.headers.get("set-cookie"), null);
    assert.equal((await post(baseUrl, "/api/setup", null, undefined, "malformed-json")).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/notes`)).status, 401);
    const common = await post(baseUrl, "/api/setup", { password: "passwordpassword", setupToken });
    assert.equal(common.status, 400);
    const setup = await post(baseUrl, "/api/setup", { password, setupToken });
    assert.equal(setup.status, 200);
    setupCookie = cookieFrom(setup);

    const setupPage = await fetch(`${baseUrl}/setup`, { redirect: "manual" });
    assert.equal(setupPage.status, 307);
    assert.equal(setupPage.headers.get("location"), "/login");
    assert.equal((await fetch(`${baseUrl}/login`)).status, 200);

    const createdKey = await post(baseUrl, "/api/keys", {
      name: "Remote MCP reader",
      scopes: ["notes:read", "search:read", "schema:read"],
    }, setupCookie);
    assert.equal(createdKey.status, 201);
    const apiKey = (await createdKey.json()).key as string;
    const mcp = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(mcp.status, 200);
    const mcpTools = (await mcp.json()).result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(mcpTools.includes("list_notes"));
    assert.ok(!mcpTools.includes("create_note"));
    assert.ok(!mcpTools.includes("index_embeddings"));

    const writeKeyResponse = await post(baseUrl, "/api/keys", { name: "Writer", scopes: ["notes:write"] }, setupCookie);
    const purgeKeyResponse = await post(baseUrl, "/api/keys", { name: "Purger", scopes: ["notes:purge"] }, setupCookie);
    const writeKey = (await writeKeyResponse.json()).key as string;
    const purgeKey = (await purgeKeyResponse.json()).key as string;
    const createdNote = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Purge scope test", content: "# Purge scope test" }),
    });
    assert.equal(createdNote.status, 201);
    const noteId = (await createdNote.json()).note.id as string;
    assert.equal((await fetch(`${baseUrl}/api/notes/${noteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${writeKey}` } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/trash/${noteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${writeKey}` } })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/trash/${noteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${purgeKey}` } })).status, 200);

    const alreadySetup = await post(baseUrl, "/api/setup", { password }, undefined, "setup-after-initialization");
    assert.equal(alreadySetup.status, 400);
    assert.match((await alreadySetup.json()).error, /already set up/i);

    const wrongLogin = await post(baseUrl, "/api/login", { password: "wrong password" });
    assert.equal(wrongLogin.status, 401);
    assert.match((await wrongLogin.json()).error, /invalid password/i);
    assert.equal((await post(baseUrl, "/api/login", null, undefined, "malformed-json")).status, 401);

    const login = await post(baseUrl, "/api/login", { password });
    assert.equal(login.status, 200);
    loginCookie = cookieFrom(login);

    // Update channel: owner-session only, same-origin mutations, bounded strict requests.
    const operationStatus = {
      v: 1, protocol: 1, heartbeatAt: Date.now(), checkedAt: Date.now(), currentVersion: "0.1.1",
      latest: { version: "0.1.2", notes: "Notes", publishedAt: "2026-10-21T00:00:00Z", url: "https://github.com/jccd-dev/chibako/releases/tag/v0.1.2" },
      checkError: null, operation: null,
    };
    writeFileSync(join(updaterDir, "out", "status.json"), JSON.stringify(operationStatus));
    const sameOrigin = { Cookie: loginCookie, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
    const postUpdate = (body: unknown, headers: Record<string, string>) =>
      fetch(`${baseUrl}/api/updates`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
    assert.equal((await fetch(`${baseUrl}/api/updates`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/updates`, { headers: { Authorization: `Bearer ${writeKey}` } })).status, 401, "API keys cannot read update status");
    const available = await fetch(`${baseUrl}/api/updates`, { headers: { Cookie: loginCookie } });
    assert.equal(available.status, 200);
    assert.deepEqual({ state: (await available.json()).state }, { state: "available" });
    assert.equal((await postUpdate({ version: "0.1.2" }, { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" })).status, 401, "bearer callers cannot start updates");
    assert.equal((await postUpdate({ version: "0.1.2" }, { ...sameOrigin, "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await postUpdate({ version: "0.1.2" }, { Cookie: loginCookie, "Content-Type": "application/json" })).status, 403, "no browser provenance is refused");
    assert.equal((await postUpdate({ version: "0.1.2", image: "evil" }, sameOrigin)).status, 400);
    assert.equal((await postUpdate("x".repeat(400), sameOrigin)).status, 413);
    assert.equal((await postUpdate({ version: "0.1.9" }, sameOrigin)).status, 409, "stale version is not queued");
    assert.deepEqual(readdirSync(join(updaterDir, "in")), [], "denied and malformed requests wrote nothing");
    assert.equal((await postUpdate({ action: "check" }, { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" })).status, 401, "bearer callers cannot trigger checks");
    assert.equal((await postUpdate({ action: "check" }, { ...sameOrigin, "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await postUpdate({ action: "check", version: "0.1.2" }, sameOrigin)).status, 400);
    assert.equal((await postUpdate({ action: "install" }, sameOrigin)).status, 400);
    assert.deepEqual(readdirSync(join(updaterDir, "in")), [], "denied and malformed checks wrote nothing");
    const check = await postUpdate({ action: "check" }, sameOrigin);
    assert.equal(check.status, 202);
    const [checkFile] = readdirSync(join(updaterDir, "in"));
    assert.deepEqual(JSON.parse(readFileSync(join(updaterDir, "in", checkFile), "utf8")), { v: 1, id: (await check.json()).requestId, action: "check" });
    assert.equal((await postUpdate({ action: "check" }, sameOrigin)).status, 409, "only one request waits at a time");
    rmSync(join(updaterDir, "in", checkFile));
    const queued = await postUpdate({ version: "0.1.2" }, sameOrigin);
    assert.equal(queued.status, 202);
    const files = readdirSync(join(updaterDir, "in"));
    assert.equal(files.length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(updaterDir, "in", files[0]), "utf8")), { v: 1, id: (await queued.json()).requestId, action: "update", version: "0.1.2" });
    assert.equal((await postUpdate({ version: "0.1.2" }, sameOrigin)).status, 409, "a second click does not queue a duplicate");
    assert.equal(readdirSync(join(updaterDir, "in")).length, 1);
    assert.ok(existsSync(join(updaterDir, "out", "status.json")));

    const notesBeforeChange = await fetch(`${baseUrl}/api/notes`, { headers: { Cookie: loginCookie } });
    assert.equal(notesBeforeChange.status, 200);
    assert.deepEqual((await notesBeforeChange.json()).notes.map((note: { title: string }) => note.title), [
      "Home",
      "How to organize notes",
      "Obsidian-style linking",
      "Setup & deployment",
    ]);

    assert.equal((await post(baseUrl, "/api/password", null, loginCookie, "malformed-json")).status, 400);
    const shortChange = await post(baseUrl, "/api/password", { current: password, next: "short" }, loginCookie);
    assert.equal(shortChange.status, 400);
    const commonChange = await post(baseUrl, "/api/password", { current: password, next: "passwordpassword" }, loginCookie);
    assert.equal(commonChange.status, 400);
    const wrongCurrent = await post(baseUrl, "/api/password", { current: "wrong password", next: nextPassword }, loginCookie);
    assert.equal(wrongCurrent.status, 401);
    assert.match((await wrongCurrent.json()).error, /current password/i);

    const changed = await post(baseUrl, "/api/password", { current: password, next: nextPassword }, loginCookie);
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), { ok: true });

    const oldSession = await fetch(`${baseUrl}/api/notes`, { headers: { Cookie: setupCookie } });
    assert.equal(oldSession.status, 401, "the setup session is invalidated");
    const currentSession = await fetch(`${baseUrl}/api/notes`, { headers: { Cookie: loginCookie } });
    assert.equal(currentSession.status, 200, "the session that changed the password survives");

    const oldPassword = await post(baseUrl, "/api/login", { password }, undefined, "password-change-verification");
    assert.equal(oldPassword.status, 401);
    const newLogin = await post(baseUrl, "/api/login", { password: nextPassword }, undefined, "password-change-verification");
    assert.equal(newLogin.status, 200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await post(baseUrl, "/api/password", { current: "wrong", next: password }, loginCookie, "password-guesses")).status, 401);
    }
    const limitedChange = await post(baseUrl, "/api/password", { current: nextPassword, next: password }, loginCookie, "password-guesses");
    assert.equal(limitedChange.status, 429);
    assert.ok(Number(limitedChange.headers.get("Retry-After")) > 0);
    assert.equal((await fetch(`${baseUrl}/api/notes`, { headers: { Cookie: loginCookie } })).status, 200, "rejected changes preserve the current session");
    assert.equal((await post(baseUrl, "/api/login", { password: nextPassword }, undefined, "unchanged-password")).status, 200);

    // Recovery status must authenticate without migrations, expired-session cleanup, or a write bypass.
    const db = new Database(join(vault, "brain.db"));
    const marker = join(vault, ".chibako-maintenance");
    try {
      db.prepare("INSERT INTO sessions (token, created_at, expires_at) VALUES (?, 0, 0)").run("expired-test-session");
      db.pragma("user_version = 0");
      const before = db.serialize();
      writeFileSync(marker, "test-recovery-operation");
      const operation = {
        id: "11111111-1111-4111-8111-111111111111", phase: "needs_attention",
        from: "0.1.1", to: "0.1.2", updatedAt: Date.now(), error: "Rollback needs operator recovery.",
      };
      writeFileSync(join(updaterDir, "out", "status.json"), JSON.stringify({ ...operationStatus, heartbeatAt: Date.now(), operation }));
      const recovery = await fetch(`${baseUrl}/api/updates`, { headers: { Cookie: loginCookie } });
      assert.equal(recovery.status, 200, "owner can read recovery status through the real maintenance fence");
      assert.deepEqual((await recovery.json()).operation, {
        id: operation.id, phase: operation.phase, to: operation.to, error: operation.error, updatedAt: operation.updatedAt,
      });
      const deniedHeaders: Record<string, string>[] = [
        {}, { Cookie: "chibako_session=invalid-test-session" }, { Cookie: setupCookie },
        { Cookie: "chibako_session=expired-test-session" }, { Authorization: `Bearer ${writeKey}` },
      ];
      for (const headers of deniedHeaders) {
        const denied = await fetch(`${baseUrl}/api/updates`, { headers });
        assert.equal(denied.status, 401, "missing, invalid, revoked, expired, and bearer credentials are refused");
        assert.deepEqual(await denied.json(), { error: "Unauthorized" });
      }
      const inboxBefore = readdirSync(join(updaterDir, "in"));
      assert.equal((await postUpdate({ version: "0.1.2" }, sameOrigin)).status, 500, "even valid owner mutations remain fenced");
      assert.equal((await postUpdate({ version: "0.1.2" }, { ...sameOrigin, "Sec-Fetch-Site": "cross-site" })).status, 500);
      assert.equal((await post(baseUrl, "/api/notes", { title: "Fenced test note", content: "Must not persist" }, loginCookie)).status, 500);
      assert.deepEqual(readdirSync(join(updaterDir, "in")), inboxBefore, "maintenance cannot queue another update");
      assert.deepEqual(db.serialize(), before, "status auth and denied writes leave the database byte-for-byte unchanged, including schema and expired sessions");
    } finally {
      rmSync(marker, { force: true });
      db.close();
    }
  } finally {
    await stopServer(server);
    rmSync(vault, { recursive: true, force: true });
    rmSync(updaterDir, { recursive: true, force: true });
  }
});
