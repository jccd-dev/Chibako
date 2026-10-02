import { expect, test } from "@playwright/test";

type TestNote = { id: string; title: string; folder: string; content: string; kind: "note"; created_at: number; updated_at: number; deleted_at: null; is_pinned: number; properties: Record<string, unknown> };

async function authenticate(page: import("@playwright/test").Page): Promise<void> {
  const clientId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/login", (route) => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/note/new");
  if (/\/setup$/.test(page.url())) {
    await page.locator("#setup-password").fill("correct horse battery staple");
    await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
  } else if (/\/login$/.test(page.url())) {
    await page.locator("#login-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
  }
}

async function createNote(page: import("@playwright/test").Page, title: string, content: string): Promise<TestNote> {
  const response = await page.request.post("/api/notes", { data: { title, content, kind: "note" } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).note as TestNote;
}

test("editor saves a create, queues edits, and retains a failed patch for Retry", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));

  let releaseCreate!: () => void;
  const createReleased = new Promise<void>((resolve) => { releaseCreate = resolve; });
  let createBody: unknown;
  let patchBody: unknown;
  let failNextPatch = false;
  let releaseFailure!: () => void;
  let failureGate: Promise<void> = Promise.resolve();
  await page.route("**/api/notes**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.url().endsWith("/api/notes")) {
      createBody = request.postDataJSON();
      await createReleased;
      await route.continue();
      return;
    }
    if (request.method() === "PATCH" && /\/api\/notes\/[^/]+$/.test(request.url())) {
      patchBody = request.postDataJSON();
      if (failNextPatch) {
        failNextPatch = false;
        await failureGate;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "offline" }),
        });
        return;
      }
    }
    await route.continue();
  });

  await page.goto("/app/note/new");
  const title = page.getByRole("textbox", { name: "Note title" });
  const content = page.getByRole("textbox", { name: "Note content" });
  await title.fill("Session test note");
  await content.fill("first body");
  await expect.poll(() => createBody).toEqual({
    title: "Session test note",
    folder: "",
    content: "first body",
    kind: "note",
  });

  await content.fill("second body");
  releaseCreate();
  await expect.poll(() => patchBody).toEqual({ content: "second body" });
  await expect(page).toHaveURL(/\/app\/note\/(?!new$)[^/]+$/);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/notes/${page.url().split("/").at(-1)}`);
    return (await response.json()).note.content;
  }).toBe("second body");

  failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  failNextPatch = true;
  const failingRequest = page.waitForRequest((request) => request.method() === "PATCH");
  await content.fill("failed body");
  await failingRequest;
  await content.fill("retry body");
  const failedResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.status() === 503);
  releaseFailure();
  await failedResponse;
  await expect(page.getByText("offline", { exact: true })).toBeVisible();
  await expect(content).toHaveValue("retry body");
  // The current UI retries with the existing save shortcut, not a Retry button.
  const retried = page.waitForResponse((response) => response.request().method() === "PATCH" && response.ok());
  await content.press("ControlOrMeta+s");
  await retried;
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("retry body");
});

test("switching Notes preserves the text saved to the previous note", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const first = await createNote(page, "Durability first note", "first body");
  const second = await createNote(page, "Durability second note", "second body");
  await page.goto(`/app/note/${first.id}`);
  const content = page.getByRole("textbox", { name: "Note content" });
  await expect(content).toHaveValue(first.content);

  await content.fill("saved first edit");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/notes/${first.id}`);
    return ((await response.json()) as { note: { content: string } }).note.content;
  }, { timeout: 15_000 }).toBe("saved first edit");

  await page.getByRole("link", { name: second.title, exact: true }).click();
  await expect(page).toHaveURL(`/app/note/${second.id}`);
  await expect(content).toHaveValue(second.content);

  await page.getByRole("link", { name: first.title, exact: true }).click();
  await expect(page).toHaveURL(`/app/note/${first.id}`);
  await expect(content).toHaveValue("saved first edit", { timeout: 15_000 });
});

test("edited note switches preserve the source editor DOM node", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const first = await createNote(page, "Identity source note", "first body");
  const second = await createNote(page, "Identity destination note", "---\ntag: second\n---\nsecond body");
  await page.goto(`/app/note/${first.id}`);
  const content = page.getByRole("textbox", { name: "Note content" });
  await expect(content).toHaveValue(first.content);
  const editor = await content.elementHandle();
  const ancestors = await content.evaluateHandle((node) => {
    const parents: Element[] = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) parents.push(parent);
    return parents;
  });
  await content.fill("edited first body");
  await page.getByRole("link", { name: second.title, exact: true }).click();
  await expect(content).toHaveValue(second.content);
  const ancestry = await content.evaluate((node, originals) => {
    const result: { same: boolean; connected: boolean; className: string }[] = [];
    let parent = node.parentElement;
    for (const original of originals) {
      result.push({ same: parent === original, connected: original.isConnected, className: original.className });
      parent = parent?.parentElement ?? null;
    }
    return result;
  }, ancestors);
  expect(await content.evaluate((node, original) => node === original, editor), JSON.stringify(ancestry)).toBe(true);
  await content.fill("---\ntag: second\n---\nedited second body");
  await page.getByRole("link", { name: first.title, exact: true }).click();
  await expect(content).toHaveValue("edited first body");
  expect(await content.evaluate((node, original) => node === original, editor)).toBe(true);
});

test("a failed save keeps the text and sends the route back to the note that holds it", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const first = await createNote(page, "Stale source note", "source body");
  const second = await createNote(page, "Stale destination note", "destination body");
  await page.goto(`/app/note/${first.id}`);

  let releaseFailure!: () => void;
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  let failedOnce = false;
  await page.route(`**/api/notes/${first.id}`, async (route) => {
    if (route.request().method() === "PATCH" && !failedOnce) {
      failedOnce = true;
      await failureGate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "offline" }) });
      return;
    }
    await route.continue();
  });

  const content = page.getByRole("textbox", { name: "Note content" });
  const saveRequest = page.waitForRequest((request) => request.url().endsWith(`/api/notes/${first.id}`) && request.method() === "PATCH");
  await content.fill("local source edit");
  await saveRequest;

  await page.getByRole("link", { name: second.title, exact: true }).click();
  releaseFailure();
  // The unsaved text outlives the switch, so the route comes back to its note.
  await expect(page).toHaveURL(`/app/note/${first.id}`);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(first.title);
  await expect(content).toHaveValue("local source edit");
  const recovered = page.waitForResponse((response) => response.request().method() === "PATCH" && response.ok());
  await content.press("ControlOrMeta+s");
  await recovered;
  await page.getByRole("link", { name: second.title, exact: true }).click();
  await expect(page).toHaveURL(`/app/note/${second.id}`);
  await expect(content).toHaveValue(second.content);
  await page.getByRole("link", { name: first.title, exact: true }).click();
  await expect(content).toHaveValue("local source edit");
});

test("a dirty editor blocks unload and persists after the save completes", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const note = await createNote(page, "Unload persistence note", "before unload");
  await page.goto(`/app/note/${note.id}`);

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route(`**/api/notes/${note.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await saveGate;
    }
    await route.continue();
  });
  const content = page.getByRole("textbox", { name: "Note content" });
  const saveRequest = page.waitForRequest((request) => request.url().endsWith(`/api/notes/${note.id}`) && request.method() === "PATCH");
  await content.fill("after unload");
  await saveRequest;
  const blocked = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(blocked).toBe(true);
  releaseSave();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/notes/${note.id}`);
    return (await response.json()).note.content;
  }).toBe("after unload");
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("after unload");
});

test("organization refresh keeps a pending local field while applying server metadata", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const note = await createNote(page, "Organization refresh note", "original body");
  await page.goto(`/app/note/${note.id}`);

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const serverNote = { ...note, title: "Server-renamed note", content: "server body" };
  await page.route(`**/api/notes/${note.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await saveGate;
      await route.continue();
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ note: serverNote }) });
      return;
    }
    await route.continue();
  });

  const content = page.getByRole("textbox", { name: "Note content" });
  const saveRequest = page.waitForRequest((request) => request.url().endsWith(`/api/notes/${note.id}`) && request.method() === "PATCH");
  await content.fill("local body during organization");
  await saveRequest;
  await page.evaluate(() => window.dispatchEvent(new Event("chibako:organized")));
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Server-renamed note");
  await expect(content).toHaveValue("local body during organization");
  const persisted = page.waitForResponse((response) => response.request().method() === "PATCH" && response.ok());
  releaseSave();
  expect((await (await persisted).json()).note.content).toBe("local body during organization");
  await expect(content).toHaveValue("local body during organization");
});

test("rich editor survives edited note switches without rebuilding its DOM", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "write"));
  const first = await createNote(page, "Rich identity first", "first body");
  const second = await createNote(page, "Rich identity second", "second body");
  await page.goto(`/app/note/${first.id}`);
  const editor = page.locator(".tiptap[contenteditable=true]");
  await expect(editor).toHaveText(first.content);
  const original = await editor.elementHandle();
  await editor.fill("rich edited body");
  await page.getByRole("link", { name: second.title, exact: true }).click();
  await expect(editor).toHaveText(second.content);
  expect(await editor.evaluate((node, previous) => node === previous, original)).toBe(true);
  await page.getByRole("link", { name: first.title, exact: true }).click();
  await expect(editor).toHaveText("rich edited body");
  expect(await editor.evaluate((node, previous) => node === previous, original)).toBe(true);
});

test("persistent rich editor rechecks HTML safety on every selected note", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "write"));
  const safe = await createNote(page, "Rich safe document", "safe body");
  const unsafe = await createNote(page, "Rich HTML document", "<details><summary>Keep this HTML</summary>body</details>");
  await page.goto(`/app/note/${safe.id}`);
  const editor = page.locator(".tiptap[contenteditable=true]");
  await expect(editor).toHaveText(safe.content);
  await page.getByRole("link", { name: unsafe.title, exact: true }).click();
  await expect(page.getByText("Rich editing is off: this note has HTML that saving would drop.")).toBeVisible();
  await expect(editor).toHaveCount(0);
  await page.getByRole("link", { name: safe.title, exact: true }).click();
  await expect(editor).toHaveText(safe.content);
  const persisted = await page.request.get(`/api/notes/${unsafe.id}`);
  expect((await persisted.json()).note.content).toBe(unsafe.content);
});

test("combined details preserve the legacy API and cached switches avoid tree requests", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const target = await createNote(page, "Combined details target", "target body");
  await createNote(page, "Combined linked source", `[[${target.title}]]`);
  await createNote(page, "Combined mention source", `Plain mention of ${target.title}`);
  const other = await createNote(page, "Combined other", "other body");
  const legacy = await page.request.get(`/api/notes/${target.id}/links`);
  const mentions = await page.request.get(`/api/notes/${target.id}/mentions`);
  const combined = await page.request.get(`/api/notes/${target.id}/links?include=mentions`);
  expect(combined.ok()).toBe(true);
  const legacyData = await legacy.json();
  expect(legacyData).not.toHaveProperty("mentions");
  expect(await combined.json()).toEqual({ ...legacyData, ...(await mentions.json()) });
  expect(legacyData.backlinks).toHaveLength(1);
  const missing = await page.request.get("/api/notes/missing-details-note/links?include=mentions");
  expect(missing.status()).toBe(404);

  const initialDetails = page.waitForResponse((r) => r.url().endsWith(`/api/notes/${target.id}/links?include=mentions`));
  await page.goto(`/app/note/${target.id}`);
  await initialDetails;
  const content = page.getByRole("textbox", { name: "Note content" });
  await expect(content).toHaveValue(target.content);
  const requests: string[] = [];
  page.on("request", (r) => { if (r.method() === "GET") requests.push(new URL(r.url()).pathname + new URL(r.url()).search); });
  const otherDetails = page.waitForResponse((r) => r.url().endsWith(`/api/notes/${other.id}/links?include=mentions`));
  await page.getByRole("link", { name: other.title, exact: true }).click();
  await expect(content).toHaveValue(other.content);
  await otherDetails;
  await page.getByRole("link", { name: target.title, exact: true }).click();
  await expect(content).toHaveValue(target.content);
  expect(requests.filter((url) => url === "/api/notes")).toEqual([]);
  expect(requests.filter((url) => /\/links|\/mentions/.test(url))).toEqual([`/api/notes/${other.id}/links?include=mentions`]);

  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok());
  await content.fill("target plain text edit");
  await saved;
  // Observe beyond the refresh trailing edge, not just before its timer fires.
  await page.waitForTimeout(1800);
  expect(requests.filter((url) => url === "/api/notes")).toEqual([]);
  expect(requests.filter((url) => /\/links|\/mentions/.test(url))).toHaveLength(1);

  const renamed = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok());
  await page.getByRole("textbox", { name: "Note title" }).fill("Combined renamed target");
  await renamed;
  await expect.poll(() => requests.filter((url) => url === "/api/notes").length).toBe(1);
  await expect.poll(() => requests.filter((url) => /\/links|\/mentions/.test(url)).length).toBe(2);
  await page.waitForTimeout(200);
  expect(requests.filter((url) => url === "/api/notes")).toHaveLength(1);
});

test("deleting a Note and choosing Undo restores it", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const note = await createNote(page, "Undo browser note", "recoverable body");
  await page.goto(`/app/note/${note.id}`);
  await page.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  const undo = page.getByRole("button", { name: "Undo" }).last();
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(page).toHaveURL(`/app/note/${note.id}`);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(note.title);
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue(note.content);
});
