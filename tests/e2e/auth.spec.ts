import { expect, test } from "@playwright/test";

test("owner setup requires its token and password changes preserve login", async ({ page }) => {
  test.setTimeout(60_000);
  const password = "correct horse battery staple";
  const nextPassword = "another unique horse battery staple";
  await page.goto("/setup");
  if (/\/setup$/.test(page.url())) {
    await page.getByLabel("Setup token", { exact: true }).fill("wrong-token");
    await page.getByLabel("Admin password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Setup token is missing or invalid" })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/setup$/);
    await page.getByLabel("Setup token", { exact: true }).fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
  } else {
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);

  await page.goto("/app/settings");
  await page.getByRole("tab", { name: "Password", exact: true }).click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  const newPassword = page.getByLabel("New password", { exact: true });
  await expect(newPassword).toHaveAttribute("minlength", "15");
  await newPassword.fill("PasswordPassword");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Choose a less common password.", { exact: true })).toBeVisible();
  await newPassword.fill(nextPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password updated.", { exact: true })).toBeVisible();

  try {
    await page.request.post("/api/logout");
    await page.goto("/login");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid password.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Password", { exact: true }).fill(nextPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
  } finally {
    const headers = { "X-Chibako-Client-IP": "auth-browser-password-cleanup" };
    const login = await page.request.post("/api/login", { headers, data: { password: nextPassword } });
    expect(login.ok()).toBeTruthy();
    const restored = await page.request.post("/api/password", { headers, data: { current: nextPassword, next: password } });
    expect(restored.ok()).toBeTruthy();
  }
});
