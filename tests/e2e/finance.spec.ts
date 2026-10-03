import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page) {
  const clientId = randomUUID();
  await page.route("**/api/login", route => route.continue({ headers: { ...route.request().headers(), "x-chibako-client-ip": clientId } }));
  await page.goto("/");
  if (/\/setup/.test(page.url())) {
    await page.locator("#setup-password").fill("correct horse battery staple");
    await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
  } else if (/\/login/.test(page.url())) {
    await page.locator("#login-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app/);
}

async function addAccount(page: Page, name: string, balance: string, kind = "money") {
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill(name);
  await page.getByLabel("Account type", { exact: true }).selectOption(kind);
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill(balance);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage " + name, exact: true })).toBeVisible();
}

for (const device of ["desktop", "mobile"]) test(device + " finance account workflow, keyboard and both themes", async ({ page, request }) => {
  await page.setViewportSize(device === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  expect((await request.get("/api/finance/accounts")).status()).toBe(401);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await authenticate(page);
  if (device === "mobile") {
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Finance", exact: true }).click();
  } else await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  const before = await (await page.request.get("/api/finance/summary")).json();
  const cash = device + " cash", wallet = device + " wallet", asset = device + " asset";
  await page.getByRole("tab", { name: "Manage", exact: true }).click();
  await addAccount(page, cash, "123.45");
  await addAccount(page, asset, "456.78", "asset");
  await addAccount(page, device + " negative", "-10.01");
  await expect(page.getByText("Negative balance. Review this account.", { exact: true }).first()).toBeVisible();
  const expected = { money: before.money.balance_cents + 11344, assets: before.assets.balance_cents + 45678 };
  const position = await (await page.request.get("/api/finance/summary")).json();
  expect(position.money.balance_cents).toBe(expected.money);
  expect(position.assets.balance_cents).toBe(expected.assets);

  await page.getByRole("button", { name: "Manage " + cash, exact: true }).click();
  await expect(page.getByLabel("Account type", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Opening balance (PHP)", { exact: true })).toBeDisabled();
  if (device === "mobile") expect((await page.getByRole("dialog").boundingBox())?.width).toBe(390);
  await page.getByLabel("Account name", { exact: true }).fill(wallet);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Manage", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Manage " + wallet, exact: true }).click();
  await page.getByRole("button", { name: "Archive account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Manage " + wallet, exact: true })).toHaveCount(0);
  expect((await (await page.request.get("/api/finance/summary")).json()).money.balance_cents).toBe(expected.money);
  await page.getByLabel("Show archived accounts").check();
  await page.getByRole("button", { name: "Manage " + wallet, exact: true }).click();
  await page.getByRole("button", { name: "Restore account", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Manage " + wallet, exact: true }).click();
  await page.route("**/api/finance/accounts/*", route => route.request().method() === "PATCH"
    ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Account changed; refresh before editing", code: "version_conflict" }) })
    : route.continue());
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Account changed; refresh before editing");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.unroute("**/api/finance/accounts/*");
  await page.getByRole("button", { name: "Add account", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  if (device === "mobile") {
    await addAccount(page, "Maximum exact negative", "-90071992547409.91");
    await page.setViewportSize({ width: 320, height: 844 });
  }
  for (const tab of ["Activity", "Planning", "Overview"]) await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByTestId("finance-money-total")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId("finance-asset-total")).toBeVisible();
  }
  expect(errors).toEqual([]);
});
