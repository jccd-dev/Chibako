import { expect, test } from "@playwright/test";

async function authenticate(page: import("@playwright/test").Page): Promise<void> {
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
  await page.evaluate(() => localStorage.setItem("chibako_view", "write"));
}

async function openNote(page: import("@playwright/test").Page, title: string, content: string): Promise<string> {
  const response = await page.request.post("/api/notes", { data: { title, content, kind: "note" } });
  expect(response.ok()).toBeTruthy();
  const { note } = await response.json();
  await page.goto(`/app/note/${note.id}`);
  return note.id;
}

test("HTML stays rich-editable and survives an edit byte-for-byte", async ({ page }) => {
  await authenticate(page);
  const html = 'Folder Projects/<area>/<project> and <span style="color:red">red</span>\n\n<div class="callout">\n  inside\n</div>\n\n<!-- hidden -->\n\nEnd';
  const id = await openNote(page, "Rich editing with HTML", `Start\n\n${html}`);

  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await expect(editor.locator(".raw-html", { hasText: "<project>" })).toBeVisible();
  await expect(editor.locator(".raw-html-block", { hasText: '<div class="callout">' })).toBeVisible();
  await expect(editor.locator("div.callout")).toHaveCount(0);

  await editor.getByText("Start").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/notes/${id}`);
    return (await response.json()).note.content;
  }).toBe(`Start edited\n\n${html}`);
});

test("plain formatting tags render as rich formatting", async ({ page }) => {
  await authenticate(page);
  await openNote(page, "Formatting tags", "a <u>under</u> <mark>marked</mark> H<sub>2</sub>O x<sup>2</sup>");

  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("u", { hasText: "under" })).toBeVisible();
  await expect(editor.locator("mark", { hasText: "marked" })).toBeVisible();
  await expect(editor.locator("sub", { hasText: "2" })).toBeVisible();
  await expect(editor.locator("sup", { hasText: "2" })).toBeVisible();
  await expect(editor.locator(".raw-html")).toHaveCount(0);
});

test("raw HTML in the rich editor shows as text and never runs", async ({ page }) => {
  await authenticate(page);
  await openNote(page, "Inert HTML", 'Img <img src="x" onerror="window.__rawHtmlRan = true"> here\n\n<script>window.__rawHtmlRan = true</script>\n\nEnd');

  const editor = page.locator(".ProseMirror");
  await expect(editor.locator(".raw-html", { hasText: "<img" })).toBeVisible();
  await expect(editor.locator("img, script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rawHtmlRan?: boolean }).__rawHtmlRan)).toBeUndefined();
});
