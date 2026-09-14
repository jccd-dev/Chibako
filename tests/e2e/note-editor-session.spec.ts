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
  await expect(page.getByRole("status")).toHaveText("Unsaved");
  await expect.poll(() => createBody).toEqual({
    title: "Session test note",
    folder: "",
    content: "first body",
    kind: "note",
  });
  await expect(page.getByRole("status")).toHaveText("Saving…");

  await content.fill("second body");
  releaseCreate();
  await expect.poll(() => patchBody).toEqual({ content: "second body" });
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/app\/note\/(?!new$)[^/]+$/);

  failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  failNextPatch = true;
  await content.fill("failed body");
  await expect(page.getByRole("status")).toHaveText("Saving…", { timeout: 15_000 });
  await content.fill("retry body");
  releaseFailure();
  await expect(page.getByRole("status")).toHaveText("Save failed", { timeout: 15_000 });
  await expect(content).toHaveValue("retry body");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("retry body");
});

test("switching Notes ignores a stale save failure from the previous Note", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const first = await createNote(page, "Stale source note", "source body");
  const second = await createNote(page, "Stale destination note", "destination body");
  await page.goto(`/app/note/${first.id}`);

  let releaseFailure!: () => void;
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  await page.route(`**/api/notes/${first.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
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

  const navigation = page.getByRole("link", { name: second.title, exact: true }).click();
  await expect(page).toHaveURL(`/app/note/${second.id}`);
  releaseFailure();
  await navigation;
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(second.title);
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue(second.content);
  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect(page.getByRole("button", { name: "Retry" })).not.toBeVisible();
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
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });
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
  releaseSave();
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });
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
