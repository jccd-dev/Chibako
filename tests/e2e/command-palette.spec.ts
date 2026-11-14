import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
  const clientId = `palette-${Date.now()}`;
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

async function createNote(page: Page, title: string, folder: string, body: string) {
  const res = await page.request.post("/api/notes", { data: { title, folder, content: `# ${title}\n\n${body}` } });
  expect(res.ok()).toBeTruthy();
}

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByRole("combobox", { name: "Command palette" });
  await expect(input).toBeVisible();
  return input;
}

const results = (page: Page) => page.locator("#command-results");

test("a body-word match shows its snippet and folder", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  const folder = `Palette ${stamp}`;
  await createNote(page, `Snippet target ${stamp}`, folder, `the marmot${stamp} burrows deep`);
  await page.goto("/app");

  const input = await openPalette(page);
  await input.fill(`marmot${stamp}`);
  const row = results(page).getByRole("option", { name: new RegExp(`Snippet target ${stamp}`) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(folder);
  await expect(row.locator("mark")).toHaveText(`marmot${stamp}`);
  await expect(results(page).getByRole("option").first()).toContainText(`Snippet target ${stamp}`);
});

test("fast typing never shows stale results", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  await createNote(page, `Alpha ${stamp}`, "", `alpha${stamp}`);
  await createNote(page, `Beta ${stamp}`, "", `beta${stamp}`);
  await page.route("**/api/search?**", async route => {
    if (route.request().url().includes(`alpha${stamp}`)) await new Promise(resolve => setTimeout(resolve, 1500));
    try { await route.continue(); } catch { /* aborted by the newer query */ }
  });
  await page.goto("/app");

  const input = await openPalette(page);
  await input.fill(`alpha${stamp}`);
  await page.waitForTimeout(400); // past the debounce, so the slow request is in flight
  await input.fill(`beta${stamp}`);
  await expect(results(page).getByRole("option", { name: new RegExp(`Beta ${stamp}`) })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(results(page).getByRole("option", { name: new RegExp(`Alpha ${stamp}`) })).toHaveCount(0);
});

test("folder: limits results and suggests folders", async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now().toString(36);
  await createNote(page, `In guides ${stamp}`, `Guides${stamp}`, `walrus${stamp}`);
  await createNote(page, `In nested ${stamp}`, `Guides${stamp}/Deep`, `walrus${stamp}`);
  await createNote(page, `Elsewhere ${stamp}`, `Other${stamp}`, `walrus${stamp}`);
  await page.goto("/app");

  const input = await openPalette(page);
  await input.fill(`folder:Guides${stamp.slice(0, 3)}`);
  const suggestion = results(page).getByRole("option", { name: `Guides${stamp}`, exact: true });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(input).toHaveValue(`folder:Guides${stamp} `);
  await input.press("End");
  await input.pressSequentially(`walrus${stamp}`);
  await expect(results(page).getByRole("option", { name: new RegExp(`In guides ${stamp}`) })).toBeVisible();
  await expect(results(page).getByRole("option", { name: new RegExp(`In nested ${stamp}`) })).toBeVisible();
  await expect(results(page).getByRole("option", { name: new RegExp(`Elsewhere ${stamp}`) })).toHaveCount(0);

  await input.fill(`folder:Guides${stamp} nothing${stamp}`);
  await expect(results(page)).toContainText(`No notes in Guides${stamp} match`);
});

test("the rail search icon and Cmd+K open the same palette", async ({ page }) => {
  await authenticate(page);
  await page.goto("/app");
  await page.getByRole("button", { name: "Search notes" }).click();
  const input = page.getByRole("combobox", { name: "Command palette" });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Search all notes" })).toHaveCount(0);
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await openPalette(page);
});
