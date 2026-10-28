import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page) {
  const clientId = randomUUID();
  await page.route("**/api/login", route => route.continue({ headers: { ...route.request().headers(), "x-chibako-client-ip": clientId } }));
  await page.goto("/");
  if (/\/setup/.test(page.url())) {
    await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
    await page.locator("#setup-password").fill("correct horse battery staple");
    await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
  } else if (/\/login/.test(page.url())) {
    await page.locator("#login-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app/);
}

test("owed-to-me and debt create flows record with or without a tracked account", async ({ page }) => {
  await authenticate(page);
  const created = await page.request.post("/api/finance/accounts", { data: { request_id: randomUUID(), name: "TEST OBL cash", kind: "money", currency: "PHP", opening_balance: "100" } });
  expect(created.ok()).toBe(true);
  const { account } = await created.json();
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await page.getByRole("link", { name: "Planning", exact: true }).click();
  const dialog = page.getByRole("dialog");

  await page.getByRole("button", { name: "Someone owes me", exact: true }).click();
  await expect(dialog.getByText("Money owed to you", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Person", exact: true }).click();
  await dialog.getByLabel("Who owes you?").fill("TEST OBL Louie");
  await dialog.locator("#obligation-amount").fill("1500");
  await dialog.locator("#obligation-already-paid").fill("500");
  await expect(dialog.getByText("PHP 1,000.00 will be recorded as still owed to you.")).toBeVisible();
  await dialog.getByRole("button", { name: "Create entry", exact: true }).click();
  await expect(dialog.getByText("Remaining collectible", { exact: true })).toBeVisible();
  await expect(dialog.getByText("PHP 1,000.00").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "I owe someone", exact: true }).click();
  await dialog.getByLabel("Who is this owed to?").fill("TEST OBL Lender");
  await dialog.locator("#obligation-amount").fill("40");
  await dialog.locator("label", { hasText: "TEST OBL cash" }).click();
  await expect(dialog.getByText("PHP 40.00 will be added to TEST OBL cash.")).toBeVisible();
  await expect(dialog.locator("#obligation-already-paid")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create debt", exact: true }).click();
  await expect(dialog.getByText("Cash movement recorded.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const after = await (await page.request.get(`/api/finance/accounts/${account.id}`)).json();
  expect(after.account.balance_cents).toBe(14000);

  await page.getByRole("button", { name: "Someone owes me", exact: true }).click();
  await dialog.getByLabel("Who owes you?").fill("TEST OBL Too much");
  await dialog.locator("#obligation-amount").fill("1000");
  await dialog.locator("label", { hasText: "TEST OBL cash" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Insufficient balance");
  await expect(dialog.getByRole("button", { name: "Create entry", exact: true })).toBeDisabled();
  const list = await (await page.request.get("/api/finance/obligations")).json();
  expect(list.obligations.map((row: { name: string; counterparty_type: string | null }) => [row.name, row.counterparty_type]))
    .toEqual(expect.arrayContaining([["TEST OBL Louie", "person"], ["TEST OBL Lender", null]]));
});

test("logging a collection, quick amounts, history and safe delete", async ({ page }) => {
  await authenticate(page);
  const accountResponse = await page.request.post("/api/finance/accounts", { data: { request_id: randomUUID(), name: "TEST LOG cash", kind: "money", currency: "PHP", opening_balance: "100" } });
  const { account } = await accountResponse.json();
  const created = await page.request.post("/api/finance/obligations", { data: { request_id: randomUUID(), kind: "receivable", name: "TEST LOG Louie", principal: "1500" } });
  const { obligation } = await created.json();
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await page.getByRole("link", { name: "Planning", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Inspect obligation TEST LOG Louie", exact: true }).click();
  await expect(dialog.getByText("Remaining collectible", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("progressbar", { name: "Repayment progress" })).toHaveAttribute("aria-valuenow", "0");

  await dialog.getByRole("button", { name: "Log collection", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /^Full amount\s*PHP 1,500\.00$/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "PHP 5,000.00" })).toHaveCount(0);
  await dialog.getByRole("button", { name: /^Half/ }).click();
  await expect(dialog.locator("#payment-amount")).toHaveValue("750");
  await dialog.locator("label", { hasText: "TEST LOG cash" }).click();
  await expect(dialog.getByText("adds PHP 750.00 to TEST LOG cash. Remaining collectible after: PHP 750.00.")).toBeVisible();
  await dialog.getByRole("button", { name: "Save collection", exact: true }).click();
  await expect(dialog.getByRole("progressbar", { name: "Repayment progress" })).toHaveAttribute("aria-valuenow", "50");
  await expect(dialog.getByText("Receivable collection", { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/finance/accounts/${account.id}`)).json()).account.balance_cents).toBe(85000);

  await dialog.getByRole("button", { name: "Log collection", exact: true }).click();
  await dialog.locator("#payment-amount").fill("100");
  await expect(dialog.getByText("adds PHP 100.00 to TEST LOG cash.")).toBeVisible();
  await dialog.locator("#payment-amount").fill("800");
  await dialog.getByRole("button", { name: "Save collection", exact: true }).click();
  await expect(dialog.getByText("Cannot exceed the remaining PHP 750.00.")).toBeVisible();
  await dialog.getByRole("button", { name: "Back", exact: true }).click();

  await dialog.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete permanently…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(dialog.getByText(/Revert this obligation's 1 cash record in Activity before deleting it/)).toBeVisible();

  const history = await (await page.request.get(`/api/finance/obligations/${obligation.id}/history?include_details=true`)).json();
  const cash = history.entries[0].cash_activity;
  const current = (await (await page.request.get(`/api/finance/obligations/${obligation.id}`)).json()).obligation;
  const reverted = await page.request.post(`/api/finance/activity/${cash.id}/revert`, { data: { request_id: randomUUID(), version: cash.version, obligation_version: current.version } });
  expect(reverted.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Inspect obligation TEST LOG Louie", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete permanently…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("button", { name: "Inspect obligation TEST LOG Louie", exact: true })).toHaveCount(0);
  await expect(page.getByText("TEST LOG Louie was deleted permanently. No account balance changed.")).toBeVisible();
  expect((await page.request.get(`/api/finance/obligations/${obligation.id}`)).status()).toBe(404);
  expect((await (await page.request.get(`/api/finance/accounts/${account.id}`)).json()).account.balance_cents).toBe(10000);
});
