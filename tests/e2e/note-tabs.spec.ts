import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
  const clientId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/login", (route) => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/note/new");
  if (/\/setup$/.test(page.url())) {
    await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
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

test("a new tab is saved before switching notes", async ({ page }) => {
  await authenticate(page);
  const source = await page.request.post("/api/notes", {
    data: { title: `Tab source ${Date.now()}`, content: "source body", kind: "note" },
  });
  expect(source.ok()).toBeTruthy();
  const sourceNote = (await source.json()).note as { id: string; title: string };

  await page.evaluate(() => localStorage.removeItem("chibako_note_tabs"));
  await page.goto(`/app/note/${sourceNote.id}`);
  await expect(page.getByRole("tab", { name: sourceNote.title })).toBeVisible();

  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/notes") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "New note tab" }).click();
  const createdResponse = await createResponse;
  expect(createdResponse.status()).toBe(201);
  const createdNote = (await createdResponse.json()).note as { id: string; title: string };

  await expect(page).toHaveURL(`/app/note/${createdNote.id}`);
  await expect(page.getByRole("tab", { name: createdNote.title })).toBeVisible();

  await page.getByRole("tab", { name: sourceNote.title }).click();
  await expect(page).toHaveURL(`/app/note/${sourceNote.id}`);
  await expect(page.getByRole("tab", { name: createdNote.title })).toBeVisible();
});

test("deleting an open note from the file manager removes its tab", async ({ page }) => {
  await authenticate(page);
  const response = await page.request.post("/api/notes", {
    data: { title: `Doomed tab ${Date.now()}`, content: "body", kind: "note" },
  });
  expect(response.ok()).toBeTruthy();
  const note = (await response.json()).note as { id: string; title: string };

  await page.evaluate(() => localStorage.removeItem("chibako_note_tabs"));
  await page.goto(`/app/note/${note.id}`);
  const tab = page.getByRole("tab", { name: note.title });
  await expect(tab).toBeVisible();

  const sidebar = page.getByRole("navigation", { name: "Files and folders" });
  const rootScope = sidebar.locator("xpath=./div").last();
  await expect(rootScope.getByRole("link", { name: note.title, exact: true })).toBeVisible();
  await rootScope.getByRole("button", { name: `Actions for ${note.title}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.locator('[role="alertdialog"]').getByRole("button", { name: "Delete", exact: true }).click();

  await expect(tab).toBeHidden();
});

test("closing the active tab does not reopen it, also after reload", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now();
  const ids: { id: string; title: string }[] = [];
  for (const label of ["Close first", "Close second"]) {
    const response = await page.request.post("/api/notes", {
      data: { title: `${label} ${stamp}`, content: "body", kind: "note" },
    });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).note as { id: string; title: string });
  }
  const [first, second] = ids;

  await page.evaluate(() => localStorage.removeItem("chibako_note_tabs"));
  await page.goto(`/app/note/${first.id}`);
  await expect(page.getByRole("tab", { name: first.title })).toBeVisible();
  await page.goto(`/app/note/${second.id}`);
  await expect(page.getByRole("tab", { name: second.title })).toBeVisible();
  await expect(page.getByRole("tab", { name: first.title })).toBeVisible();

  await page.getByRole("button", { name: `Close ${second.title} tab` }).click();
  await expect(page).toHaveURL(`/app/note/${first.id}`);
  await page.waitForTimeout(1500);
  await expect(page.getByRole("tab", { name: second.title })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("tab", { name: first.title })).toBeVisible();
  await expect(page.getByRole("tab", { name: second.title })).toHaveCount(0);
});
