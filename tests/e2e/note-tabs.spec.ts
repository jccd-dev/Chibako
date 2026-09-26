import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
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
