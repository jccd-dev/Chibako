import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
  const clientId = `sidebar-files-${Date.now()}`;
  await page.route("**/api/login", route => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/note/new");
  if (/\/(setup|login)$/.test(page.url())) {
    const setup = /\/setup$/.test(page.url());
    await page.locator(setup ? "#setup-password" : "#login-password").fill("correct horse battery staple");
    if (setup) await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: setup ? "Create account" : "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
}

async function createNote(request: APIRequestContext, title: string, folder = ""): Promise<{ id: string }> {
  const res = await request.post("/api/notes", { data: { title, folder, content: `# ${title}\n\nbody` } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).note as { id: string };
}

test("clicking a folder points New file at that folder", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const folder = `Target ${stamp}`;
  const title = `In target ${stamp}`;
  expect((await page.request.post("/api/folders", { data: { path: folder } })).ok()).toBeTruthy();
  await page.goto("/app");

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const folderButton = sidebar.getByRole("button", { name: folder, exact: true });
  await folderButton.click();
  await expect(folderButton).toHaveAttribute("aria-pressed", "true");

  await sidebar.getByRole("button", { name: "New file" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#item-parent")).toHaveText(folder);
  await dialog.locator("#item-name").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect.poll(async () => {
    const list = await (await page.request.get("/api/notes")).json();
    return (list.notes as Array<{ title: string; folder: string }>).find(n => n.title === title)?.folder;
  }).toBe(folder);
});

test("importing a Markdown file creates a note with its content", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const title = `Imported ${stamp}`;

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await sidebar.locator('input[type="file"]').setInputFiles({
    name: `${title}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${title}\n\nimported body`),
  });

  const findNote = async () => {
    const list = await (await page.request.get("/api/notes")).json();
    return (list.notes as Array<{ id: string; title: string }>).find(n => n.title === title);
  };
  await expect.poll(async () => (await findNote())?.id).not.toBeUndefined();
  const note = (await findNote())!;
  const full = await (await page.request.get(`/api/notes/${note.id}`)).json();
  expect((full.note as { content: string }).content).toContain("imported body");
});

test("Markdown import keeps successful Notes when another import fails", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const good = `Good import ${stamp}`;
  const bad = `Bad import ${stamp}`;
  await page.route("**/api/notes", route => {
    if (route.request().method() === "POST" && route.request().postDataJSON().title === bad) {
      return route.fulfill({ status: 400, json: { error: "Cannot import this Note" } });
    }
    return route.continue();
  });
  await page.getByRole("complementary", { name: "Sidebar" }).locator('input[type="file"]').setInputFiles(
    [bad, good].map(title => ({ name: `${title}.md`, mimeType: "text/markdown", buffer: Buffer.from(title) })),
  );
  await expect.poll(async () => {
    const { notes } = await (await page.request.get("/api/notes")).json();
    return notes.filter((note: { title: string }) => [bad, good].includes(note.title)).map((note: { title: string }) => note.title);
  }).toEqual([good]);
});

test("cmd-click multi-select deletes several files at once", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const titles = [`Bulk one ${stamp}`, `Bulk two ${stamp}`];
  const ids = await Promise.all(titles.map(t => createNote(page.request, t).then(n => n.id)));

  await page.goto("/app");
  const root = page.getByRole("navigation", { name: "Files and folders" }).locator("xpath=./div").last();
  const row = (title: string) => root.getByRole("link", { name: title, exact: true });
  await row(titles[0]).click({ modifiers: ["Meta"] });
  await row(titles[1]).click({ modifiers: ["Meta"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.locator('[role="alertdialog"]').getByRole("button", { name: "Delete", exact: true }).click();

  await expect.poll(async () => {
    const trashed = await (await page.request.get("/api/trash")).json();
    const trashedIds = (trashed.notes as Array<{ id: string }>).map(n => n.id);
    return ids.every(id => trashedIds.includes(id));
}).toBe(true);
});

test("dragging a multi-selected file moves all selected files", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const folder = `Move all ${stamp}`;
  const titles = [`Move one ${stamp}`, `Move two ${stamp}`];
  expect((await page.request.post("/api/folders", { data: { path: folder } })).ok()).toBeTruthy();
  await Promise.all(titles.map(t => createNote(page.request, t)));

  await page.goto("/app");
  const sidebar = page.getByRole("navigation", { name: "Files and folders" });
  const root = sidebar.locator("xpath=./div").last();
  const row = (title: string) => root.getByRole("link", { name: title, exact: true });
  await row(titles[0]).click({ modifiers: ["Meta"] });
  await row(titles[1]).click({ modifiers: ["Meta"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  const batchRequests: string[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/api/notes/batch")) batchRequests.push(request.postData() ?? "");
  });

  const source = row(titles[0]).locator("xpath=ancestor::div[@draggable='true'][1]");
  await source.dragTo(root.getByRole("button", { name: folder, exact: true }));

  await expect.poll(async () => {
    const list = await (await page.request.get("/api/notes")).json();
    return (list.notes as Array<{ title: string; folder: string }>)
      .filter(n => titles.includes(n.title))
      .every(n => n.folder === folder);
  }).toBe(true);
  await expect(page.getByText("2 selected")).toBeHidden();
  expect(batchRequests).toHaveLength(1);
});

test("a conflicting multi-Note drag leaves the entire selection unchanged", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const folder = `Conflict target ${stamp}`;
  const titles = [`Can move ${stamp}`, `Cannot move ${stamp}`];
  const ids = await Promise.all(titles.map(title => createNote(page.request, title).then(note => note.id)));
  await createNote(page.request, titles[1], folder);
  await page.goto("/app");
  const root = page.getByRole("navigation", { name: "Files and folders" }).locator("xpath=./div").last();
  for (const title of titles) await root.getByRole("link", { name: title, exact: true }).click({ modifiers: ["Meta"] });
  const result = page.waitForResponse(response => response.url().endsWith("/api/notes/batch"));
  await root.getByRole("link", { name: titles[0], exact: true })
    .locator("xpath=ancestor::div[@draggable='true'][1]")
    .dragTo(root.getByRole("button", { name: folder, exact: true }));
  expect((await result).status()).toBe(409);
  for (const id of ids) {
    const data = await (await page.request.get(`/api/notes/${id}`)).json();
    expect(data.note.folder).toBe("");
  }
  await expect(page.getByText("2 selected")).toBeVisible();
});

test("Note batches validate input and require the action's scope", async ({ page, request }) => {
  await authenticate(page);
  const note = await createNote(page.request, `Scoped batch ${Date.now()}`);
  const key = async (scope: string): Promise<string> => {
    const response = await page.request.post("/api/keys", { data: { name: "Batch test", scopes: [scope] } });
    expect(response.status()).toBe(201);
    return (await response.json()).key;
  };
  const writeHeaders = { Authorization: `Bearer ${await key("notes:write")}` };
  const purgeHeaders = { Authorization: `Bearer ${await key("notes:purge")}` };
  const readHeaders = { Authorization: `Bearer ${await key("notes:read")}` };
  const deleted = { action: "delete", ids: [note.id] };
  expect((await request.post("/api/notes/batch", { data: deleted })).status()).toBe(401);
  expect((await request.post("/api/notes/batch", { headers: readHeaders, data: deleted })).status()).toBe(403);
  expect((await request.post("/api/notes/batch", { headers: writeHeaders, data: { action: "delete", ids: [] } })).status()).toBe(400);
  expect((await request.post("/api/notes/batch", { headers: writeHeaders, data: deleted })).status()).toBe(200);
  const purged = { action: "purge", ids: [note.id] };
  expect((await request.post("/api/notes/batch", { headers: writeHeaders, data: purged })).status()).toBe(403);
  expect((await request.post("/api/notes/batch", { headers: purgeHeaders, data: { action: "restore", ids: [note.id] } })).status()).toBe(403);
  expect((await request.post("/api/notes/batch", { headers: purgeHeaders, data: purged })).status()).toBe(200);
});

test("plain clicks and open space clear multi-selection", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const folder = `Reset ${stamp}`;
  const titles = [`Keep one ${stamp}`, `Keep two ${stamp}`];
  expect((await page.request.post("/api/folders", { data: { path: folder } })).ok()).toBeTruthy();
  await Promise.all(titles.map(t => createNote(page.request, t)));

  await page.goto("/app");
  const sidebar = page.getByRole("navigation", { name: "Files and folders" });
  const root = sidebar.locator("xpath=./div").last();
  const row = (title: string) => root.getByRole("link", { name: title, exact: true });
  await row(titles[0]).click({ modifiers: ["Meta"] });
  await row(titles[1]).click({ modifiers: ["Meta"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  const folderButton = root.getByRole("button", { name: folder, exact: true });
  await folderButton.click();
  await expect(folderButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 selected")).toBeHidden();

  await row(titles[0]).click({ modifiers: ["Meta"] });
  await row(titles[1]).click({ modifiers: ["Meta"] });
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(folderButton).toHaveAttribute("aria-pressed", "false");

  await folderButton.click();
  const rootBox = await root.boundingBox();
  if (!rootBox) throw new Error("Root drop area is not visible.");
  await page.mouse.click(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height - 6);
  await expect(page.getByText("2 selected")).toBeHidden();
  await expect(folderButton).toHaveAttribute("aria-pressed", "false");
});

test("deleting one multi-selected file deletes all selected files", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const titles = [`Menu one ${stamp}`, `Menu two ${stamp}`];
  const ids = await Promise.all(titles.map(t => createNote(page.request, t).then(n => n.id)));

  await page.goto("/app");
  const sidebar = page.getByRole("navigation", { name: "Files and folders" });
  const root = sidebar.locator("xpath=./div").last();
  const row = (title: string) => root.getByRole("link", { name: title, exact: true });
  await row(titles[0]).click({ modifiers: ["Meta"] });
  await row(titles[1]).click({ modifiers: ["Meta"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  await root.getByRole("button", { name: `Actions for ${titles[0]}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.locator('[role="alertdialog"]').getByRole("button", { name: "Delete", exact: true }).click();

  await expect.poll(async () => {
    const trashed = await (await page.request.get("/api/trash")).json();
    const trashedIds = (trashed.notes as Array<{ id: string }>).map(n => n.id);
    return ids.every(id => trashedIds.includes(id));
  }).toBe(true);
  await expect(page.getByText("2 selected")).toBeHidden();
});

test("cmd-click multi-select purges several trashed files at once", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const titles = [`Trash one ${stamp}`, `Trash two ${stamp}`];
  const ids = await Promise.all(titles.map(async t => {
    const note = await createNote(page.request, t);
    expect((await page.request.delete(`/api/notes/${note.id}`)).ok()).toBeTruthy();
    return note.id;
  }));

  await page.goto("/app");
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByTitle(titles[0]).click();
  await page.getByTitle(titles[1]).click({ modifiers: ["Meta"] });
  await expect(page.getByRole("button", { name: "Clear selection" }).locator("..")).toContainText("2");

  await page.getByRole("button", { name: "Delete forever", exact: true }).click();
  await page.locator('[role="alertdialog"]').getByRole("button", { name: "Delete forever", exact: true }).click();

  await expect.poll(async () => {
    const trashed = await (await page.request.get("/api/trash")).json();
    const trashedIds = (trashed.notes as Array<{ id: string }>).map(n => n.id);
    return ids.some(id => trashedIds.includes(id));
  }).toBe(false);
});
