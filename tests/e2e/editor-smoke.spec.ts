import { expect, test } from "@playwright/test";

test("a user can set up, edit a Note, and reload persisted content", async ({ page }) => {
  // The e2e vault is shared across specs, so set it up only if no earlier spec did.
  await page.goto("/app");
  if (/\/setup$/.test(page.url())) {
    await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
    await page.locator("#setup-password").fill("correct horse battery staple");
    await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
  } else if (/\/login$/.test(page.url())) {
    await page.locator("#login-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);

  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  await page.goto("/app/note/new");
  await page.getByRole("textbox", { name: "Note title" }).fill("Browser smoke note");
  await page.getByRole("textbox", { name: "Note content" }).fill("persisted from the browser");

  await expect(page).toHaveURL(/\/app\/note\/(?!new\b)[^/?]+$/, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Browser smoke note");
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("persisted from the browser");
});
