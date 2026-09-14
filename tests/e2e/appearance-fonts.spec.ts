import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
  const clientId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/login", (route) => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/settings");
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
  await page.goto("/app/settings");
}

test("font controls apply separate choices immediately and restore them after reload", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await authenticate(page);
  await page.evaluate(() => localStorage.removeItem("chibako_appearance"));
  await page.reload();

  await page.getByRole("tab", { name: "Appearance" }).click();
  const interfaceFont = page.getByRole("combobox", { name: "Interface font" });
  const noteFont = page.getByRole("combobox", { name: "Note font" });
  await expect(interfaceFont).toContainText("DM Sans");
  await expect(noteFont).toContainText("DM Sans");

  const initialInterfaceFamily = await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily);
  await interfaceFont.click();
  await expect(page.getByRole("option", { name: "Questrial" })).toBeVisible();
  const optionFamilies = await page.getByRole("option").evaluateAll((options) =>
    options.map((option) => getComputedStyle(option).fontFamily)
  );
  expect(new Set(optionFamilies).size).toBe(4);
  await page.getByRole("option", { name: "Questrial" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-interface-font", "questrial");
  await expect.poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily)).not.toBe(initialInterfaceFamily);

  await noteFont.click();
  await page.getByRole("option", { name: "Quicksand" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-note-font", "quicksand");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("chibako_appearance"))).toBe(
    JSON.stringify({ interfaceFont: "questrial", noteFont: "quicksand" })
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-interface-font", "questrial");
  await expect(page.locator("html")).toHaveAttribute("data-note-font", "quicksand");
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByRole("combobox", { name: "Interface font" })).toContainText("Questrial");
  await expect(page.getByRole("combobox", { name: "Note font" })).toContainText("Quicksand");

  await page.evaluate(() => localStorage.setItem("chibako_appearance", "{\"interfaceFont\":\"obsolete\",\"noteFont\":\"obsolete\"}"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-interface-font", "dm-sans");
  await expect(page.locator("html")).toHaveAttribute("data-note-font", "dm-sans");
  const schemaFamily = await page.locator("textarea.font-mono").evaluate((element) => getComputedStyle(element).fontFamily);
  expect(schemaFamily).toContain("monospace");
  expect(consoleErrors).toEqual([]);
});

test("the selected note font covers source, rich, and preview while code stays monospace", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("tab", { name: "Appearance" }).click();
  const noteFont = page.getByRole("combobox", { name: "Note font" });
  await noteFont.click();
  await page.getByRole("option", { name: "Questrial" }).click();

  const title = `Font coverage ${Date.now()}`;
  const response = await page.request.post("/api/notes", {
    data: { title, content: "# Reading heading\n\nReadable body with `inline code`.", kind: "note" },
  });
  expect(response.ok()).toBeTruthy();
  const note = (await response.json()).note as { id: string };

  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  await page.goto(`/app/note/${note.id}`);
  const source = page.getByRole("textbox", { name: "Note content" });
  const expectedFamily = await page.locator("html").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--font-questrial").replaceAll(/[\"']/g, "").trim()
  );
  const sourceFamily = await source.evaluate((element) => getComputedStyle(element).fontFamily.replaceAll(/[\"']/g, ""));
  expect(sourceFamily).toContain(expectedFamily);

  await page.evaluate(() => localStorage.setItem("chibako_view", "write"));
  await page.reload();
  const richEditor = page.locator(".wt-editor .ProseMirror");
  await expect(richEditor).toBeVisible();
  const richFamily = await richEditor.evaluate((element) => getComputedStyle(element).fontFamily.replaceAll(/[\"']/g, ""));
  expect(richFamily).toContain(expectedFamily);

  await page.evaluate(() => localStorage.setItem("chibako_view", "preview"));
  await page.reload();
  const preview = page.locator(".md");
  await expect(preview.getByRole("heading", { name: "Reading heading" })).toBeVisible();
  const previewFamily = await preview.evaluate((element) => getComputedStyle(element).fontFamily.replaceAll(/[\"']/g, ""));
  const headingFamily = await preview.getByRole("heading", { name: "Reading heading" }).evaluate((element) => getComputedStyle(element).fontFamily.replaceAll(/[\"']/g, ""));
  const codeFamily = await preview.locator("code").evaluate((element) => getComputedStyle(element).fontFamily.replaceAll(/[\"']/g, ""));
  expect(previewFamily).toContain(expectedFamily);
  expect(headingFamily).toContain(expectedFamily);
  expect(codeFamily).not.toContain(expectedFamily);
});
