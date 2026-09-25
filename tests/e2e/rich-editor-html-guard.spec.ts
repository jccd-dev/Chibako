import { expect, test } from "@playwright/test";

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
  await page.evaluate(() => localStorage.setItem("chibako_view", "write"));
}

async function openNote(page: import("@playwright/test").Page, title: string, content: string): Promise<void> {
  const response = await page.request.post("/api/notes", { data: { title, content, kind: "note" } });
  expect(response.ok()).toBeTruthy();
  const { note } = await response.json();
  await page.goto(`/app/note/${note.id}`);
}

test("plain Markdown with autolinks and angle-bracket shortcuts keeps rich editing", async ({ page }) => {
  await authenticate(page);
  await openNote(
    page,
    "Rich editing stays on",
    "Press <Cmd+S> to save, or see <https://example.com> and <me@example.com>.\n\nLink with [[wikilinks]].",
  );

  await expect(page.getByText("Rich editing is off")).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toBeVisible();
});

test("HTML in the body turns rich editing off and names what it found", async ({ page }) => {
  await authenticate(page);
  await openNote(page, "Rich editing off", "Text before\n\n<div class=\"callout\">\n  inside\n</div>\n\n<!-- hidden -->\n");

  const warning = page.getByText("Rich editing is off");
  await expect(warning).toBeVisible();
  await expect(page.getByText('<div class="callout">', { exact: true })).toBeVisible();
  await expect(page.getByText("<!-- hidden -->", { exact: true })).toBeVisible();
});
