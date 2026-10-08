import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

const password = "correct horse battery staple";
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
      ...(clientId ? { "X-Chibako-Client-IP": clientId } : {}),
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
      env: { ...process.env, CHIBAKO_DATA_DIR: vault, CHIBAKO_BUILD_DIR: buildDir },
      stdio: "ignore",
    },
  );
  let setupCookie = "";
  let loginCookie = "";
  try {
    await waitForServer(baseUrl, server);

    const short = await post(baseUrl, "/api/setup", { password: "short" });
    assert.equal(short.status, 400);
    assert.match((await short.json()).error, /at least 8/i);

    const setup = await post(baseUrl, "/api/setup", { password });
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
    const inspectionPath = "/api/finance/import/inspect";
    const syntheticBackup = { app: "Tarsi", data: { accounts: [], expenses: [] } };
    const inspectionDb = new Database(join(vault, "brain.db"), { readonly: true });
    try {
      const before = inspectionDb.serialize();
      const inspected = await post(baseUrl, inspectionPath, syntheticBackup, setupCookie);
      assert.equal(inspected.status, 200);
      assert.equal(inspected.headers.get("cache-control"), "no-store");
      const report = await inspected.json();
      assert.equal(report.stage, "source-inspection");
      assert.equal(report.eligible, true, "seeded Notes do not block finance inspection");
      for (const authorization of [`Bearer ${apiKey}`, "Bearer invalid"]) {
        const denied = await fetch(`${baseUrl}${inspectionPath}`, {
          method: "POST", headers: { Cookie: setupCookie, Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify(syntheticBackup),
        });
        assert.equal(denied.status, 403);
        assert.equal((await denied.json()).code, "owner_required");
      }
      assert.equal((await post(baseUrl, inspectionPath, syntheticBackup)).status, 401);
      const foreign = await fetch(`${baseUrl}${inspectionPath}`, {
        method: "POST", headers: { Cookie: setupCookie, Origin: "https://foreign.test", "Content-Type": "application/json" },
        body: JSON.stringify(syntheticBackup),
      });
      assert.equal(foreign.status, 403);
      const malformed = await fetch(`${baseUrl}${inspectionPath}`, {
        method: "POST", headers: { Cookie: setupCookie, "Content-Type": "application/json" }, body: "{",
      });
      assert.equal(malformed.status, 400);
      const oversized = await fetch(`${baseUrl}${inspectionPath}`, {
        method: "POST", headers: { Cookie: setupCookie, "Content-Type": "application/json" }, body: " ".repeat(8 * 1024 * 1024 + 1),
      });
      assert.equal(oversized.status, 413);
      const previewPath = `${inspectionPath}?preview=1`;
      const previewBody = { backup: syntheticBackup, exclusions: [], acknowledged_exclusions: [] };
      const preview = await post(baseUrl, previewPath, previewBody, setupCookie);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("cache-control"), "no-store");
      const proposal = await preview.json();
      assert.equal(proposal.stage, "reconciled-preview");
      assert.equal(proposal.can_approve, true);
      assert.match(proposal.commit_notice, /recoverable backup/);
      assert.equal((await post(baseUrl, previewPath, { ...previewBody, can_approve: true }, setupCookie)).status, 400);
      assert.equal((await post(baseUrl, previewPath, previewBody)).status, 401);
      const agentPreview = await fetch(`${baseUrl}${previewPath}`, {
        method: "POST", headers: { Cookie: setupCookie, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(previewBody),
      });
      assert.equal(agentPreview.status, 403);
      const invalidPreview = await post(baseUrl, previewPath, { backup: { app: "Tarsi", data: {
        accounts: [{ id: "TEST cash", name: "TEST cash", type: "debit", currency: "PHP", balance: 1.001 }],
      } } }, setupCookie);
      assert.equal(invalidPreview.status, 200);
      assert.equal((await invalidPreview.json()).can_approve, false);
      assert.deepEqual(inspectionDb.serialize(), before, "owner inspection and denied requests leave the Vault unchanged");
    } finally { inspectionDb.close(); }
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

    const alreadySetup = await post(baseUrl, "/api/setup", { password });
    assert.equal(alreadySetup.status, 400);
    assert.match((await alreadySetup.json()).error, /already set up/i);

    const wrongLogin = await post(baseUrl, "/api/login", { password: "wrong password" });
    assert.equal(wrongLogin.status, 401);
    assert.match((await wrongLogin.json()).error, /invalid password/i);

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
  } finally {
    await stopServer(server);
    rmSync(vault, { recursive: true, force: true });
  }
});
