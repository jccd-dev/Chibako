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
    if (setup) {
      await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
      await page.locator("#setup-confirm").fill("correct horse battery staple");
    }
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

test("opening a nested note reveals it and Collapse folders closes the tree", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const outer = `Reveal ${stamp}`;
  const inner = `${outer}/Inner`;
  const note = await createNote(page.request, `Deep ${stamp}`, inner);
  await page.goto(`/app/note/${note.id}`);

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(sidebar.getByRole("button", { name: outer, exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("button", { name: "Inner", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("navigation").locator('[aria-current="page"]').last()).toBeInViewport();

  await sidebar.getByRole("button", { name: "Collapse folders" }).click();
  await expect(sidebar.getByRole("button", { name: outer, exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("Collapse folders stays reachable after scrolling a long file tree", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  for (let i = 0; i < 40; i++) await createNote(page.request, `Scroll ${stamp} ${i}`);
  await page.goto("/app");

  const tree = page.getByRole("navigation", { name: "Files and folders" });
  await expect(tree.getByRole("link", { name: `Scroll ${stamp} 39`, exact: true })).toBeAttached();
  await tree.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(tree.getByRole("button", { name: "Collapse folders" })).toBeInViewport();
});

test("Duplicate opens a copy with the same body and properties", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const folder = `Dup ${stamp}`;
  const title = `Original ${stamp}`;
  const content = `---\nstatus: draft\n---\n# ${title}\n\nduplicated body`;
  const res = await page.request.post("/api/notes", { data: { title, folder, content } });
  expect(res.ok()).toBeTruthy();
  await page.goto("/app");

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await sidebar.getByRole("button", { name: folder, exact: true }).click();
  const readCopy = async (copy: string) => {
    const before = page.url();
    await sidebar.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL(url => url.href !== before && /\/app\/note\/[^/]+$/.test(url.pathname));
    const id = page.url().split("/").pop()!;
    await expect.poll(async () => (await (await page.request.get(`/api/notes/${id}`)).json()).note?.title).toBe(copy);
    return (await (await page.request.get(`/api/notes/${id}`)).json()).note as { folder: string; content: string; properties: Record<string, unknown> };
  };

  const first = await readCopy(`${title} copy`);
  expect(first.folder).toBe(folder);
  expect(first.content).toBe(content);
  expect(first.properties).toEqual({ status: "draft" });
  await expect(sidebar.getByRole("button", { name: `Actions for ${title} copy`, exact: true })).toBeVisible();
  const second = await readCopy(`${title} copy 2`);
  expect(second.content).toBe(content);
});

test("Export .md downloads the note and re-importing restores its properties", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const title = `Export: ${stamp}?`;
  const content = `---\nstatus: done\npriority: 2\n---\n# Export ${stamp}\n\nexported body`;
  expect((await page.request.post("/api/notes", { data: { title, content } })).ok()).toBeTruthy();
  await page.goto("/app");

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await sidebar.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export .md" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`Export ${stamp}.md`);
  const text = await new Promise<string>(async (resolve, reject) => {
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
  expect(text).toBe(content);

  const reimported = `Reimported ${stamp}`;
  await sidebar.locator('input[type="file"]').setInputFiles({ name: `${reimported}.md`, mimeType: "text/markdown", buffer: Buffer.from(text) });
  const find = async () => ((await (await page.request.get("/api/notes")).json()).notes as Array<{ title: string; properties: Record<string, unknown> }>).find(n => n.title === reimported);
  await expect.poll(async () => (await find())?.properties).toEqual({ status: "done", priority: 2 });
});

test("filtering the file tree shows matches with their folders and clearing restores it", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const outer = `Filter ${stamp}`;
  const inner = `Inner ${stamp}`;
  await createNote(page.request, `Match ${stamp}`, `${outer}/${inner}`);
  expect((await page.request.patch(`/api/notes/${(await createNote(page.request, `Hit body ${stamp}`, `${outer}/${inner}`)).id}`, { data: { content: `# x\n\nnarwhal${stamp}` } })).ok()).toBeTruthy();
  await createNote(page.request, `Sibling ${stamp}`, outer);
  await createNote(page.request, `Root ${stamp}`);
  await page.goto("/app");

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const root = page.getByRole("navigation", { name: "Files and folders" }).locator("xpath=./div").last();
  const folder = (name: string) => root.getByRole("button", { name, exact: true });
  const row = (title: string) => root.getByRole("link", { name: title, exact: true });
  await folder(outer).click();
  await expect(folder(inner)).toHaveAttribute("aria-expanded", "false");
  await row(`Root ${stamp}`).click({ modifiers: ["Meta"] });
  await row(`Sibling ${stamp}`).click({ modifiers: ["Meta"] });
  await expect(page.getByText("2 selected")).toBeVisible();

  const filter = sidebar.getByRole("textbox", { name: "Filter files" });
  await filter.fill(`narwhal${stamp}`);
  await expect(row(`Hit body ${stamp}`)).toBeVisible();
  await expect(folder(inner)).toHaveAttribute("aria-expanded", "true");
  await expect(row(`Match ${stamp}`)).toHaveCount(0);
  await expect(row(`Sibling ${stamp}`)).toHaveCount(0);
  await expect(row(`Root ${stamp}`)).toHaveCount(0);
  await expect(page.getByText("2 selected")).toHaveCount(0);

  await filter.press("Escape");
  await expect(filter).toHaveValue("");
  await expect(row(`Sibling ${stamp}`)).toBeVisible();
  await expect(row(`Root ${stamp}`)).toBeVisible();
  await expect(folder(inner)).toHaveAttribute("aria-expanded", "false");
});

test("Focus folder shows only that folder's subtree", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const guides = `Guides ${stamp}`;
  await createNote(page.request, `Guide note ${stamp}`, guides);
  await createNote(page.request, `Deep guide ${stamp}`, `${guides}/Deep ${stamp}`);
  await createNote(page.request, `Outside ${stamp}`);
  await page.goto("/app");

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const root = page.getByRole("navigation", { name: "Files and folders" }).locator("xpath=./div").last();
  await root.getByRole("button", { name: `Actions for ${guides}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Focus folder" }).click();

  await expect(sidebar.getByRole("textbox", { name: "Filter files" })).toHaveValue(`folder:"${guides}"`);
  await expect(root.getByRole("link", { name: `Guide note ${stamp}`, exact: true })).toBeVisible();
  await expect(root.getByRole("button", { name: `Deep ${stamp}`, exact: true })).toBeVisible();
  await expect(root.getByRole("link", { name: `Outside ${stamp}`, exact: true })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "Clear filter" }).click();
  await expect(root.getByRole("link", { name: `Outside ${stamp}`, exact: true })).toBeVisible();

  // Folder names match regardless of case.
  await sidebar.getByRole("textbox", { name: "Filter files" }).fill(`folder:"${guides.toLowerCase()}"`);
  await expect(root.getByRole("link", { name: `Guide note ${stamp}`, exact: true })).toBeVisible();
  await expect(root.getByRole("link", { name: `Outside ${stamp}`, exact: true })).toHaveCount(0);
});
