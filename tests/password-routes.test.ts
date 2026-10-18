import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  const port = 3200 + (process.pid % 700);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: { ...process.env, CHIBAKO_DATA_DIR: vault, CHIBAKO_BUILD_DIR: buildDir, CHIBAKO_SETUP_TOKEN: setupToken, CHIBAKO_TRUST_PROXY: "true" },
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
  } finally {
    await stopServer(server);
    rmSync(vault, { recursive: true, force: true });
  }
});
