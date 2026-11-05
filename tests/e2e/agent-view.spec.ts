import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
  const clientId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/login", (route) => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/agent");
  if (/\/setup$/.test(page.url())) {
    await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
    await page.locator("#setup-password").fill("correct horse battery staple");
    await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
  } else if (/\/login/.test(page.url())) {
    await page.locator("#login-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/);
  }
}

test("Agent view starts from recall and presents observations as legacy", async ({ page }) => {
  await authenticate(page);
  await page.goto("/app/agent");
  await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();

  const workflow = page.locator("section", { has: page.getByRole("heading", { name: "Recommended agent workflow" }) });
  await expect(workflow.locator("code", { hasText: "recall" }).first()).toBeVisible();
  await expect(workflow.getByText("list_observations")).toHaveCount(0);

  await expect(page.getByText("Save a durable fact or decision as a Note that recall finds")).toBeVisible();
  await expect(page.getByText("List legacy observation rows saved before Fact notes.")).toBeVisible();
});
