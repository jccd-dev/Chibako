import { expect, test } from "@playwright/test";

test("a user can set up, edit a Note, and reload persisted content", async ({ page }) => {
  await page.goto("/setup");
  await page.locator("#setup-password").fill("correct horse battery staple");
  await page.locator("#setup-confirm").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);

  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  await page.goto("/app/note/new");
  await page.getByRole("textbox", { name: "Note title" }).fill("Browser smoke note");
  await page.getByRole("textbox", { name: "Note content" }).fill("persisted from the browser");

  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/app\/note\/(?!new$)[^/]+$/);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Browser smoke note");
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("persisted from the browser");
});
