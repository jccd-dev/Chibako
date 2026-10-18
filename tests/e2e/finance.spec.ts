import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chooseFinanceDate } from "./finance-date-controls";

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

async function addAccount(page: Page, name: string, balance: string, kind = "money") {
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill(name);
  await page.getByLabel("Account type", { exact: true }).selectOption(kind);
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill(balance);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View " + name, exact: true })).toBeVisible();
}

test("goal withdrawals validate available money and show progress", async ({ page }) => {
  await authenticate(page);
  const accountResponse = await page.request.post("/api/finance/accounts", { data: {
    request_id: randomUUID(), name: "TEST GOAL withdrawal cash", kind: "money", currency: "PHP", opening_balance: "100",
  } });
  expect(accountResponse.ok()).toBe(true);
  const { account } = await accountResponse.json();
  const goalResponse = await page.request.post("/api/finance/goals", { data: {
    request_id: randomUUID(), name: "TEST GOAL withdrawal validation", target: "100",
  } });
  expect(goalResponse.ok()).toBe(true);
  const { goal } = await goalResponse.json();
  const movement = { request_id: randomUUID(), version: goal.version, direction: "deposit", account_id: account.id, amount: "25" };
  const deposit = await page.request.post(`/api/finance/goals/${goal.id}/movements`, { data: movement });
  expect(deposit.ok()).toBe(true);
  const { goal: funded } = await deposit.json();
  const rejected = await page.request.post(`/api/finance/goals/${goal.id}/movements`, { data: {
    ...movement, request_id: randomUUID(), version: funded.version, direction: "withdrawal", amount: "25.01",
  } });
  expect(rejected.status()).toBe(409);
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await page.getByRole("link", { name: "Planning", exact: true }).click();
  const row = page.getByRole("button", { name: `Edit goal ${goal.name}`, exact: true });
  await expect(row).toContainText("25%");
  await row.click();
  await page.getByLabel("Action", { exact: true }).selectOption("withdrawal");
  await page.getByLabel("Destination account", { exact: true }).selectOption(account.id);
  await expect(page.getByText(/Available to withdraw:/)).toBeVisible();
  await page.locator("#goal-movement-amount").fill("25.01");
  let submitted = 0;
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith(`/goals/${goal.id}/movements`)) submitted++;
  });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Amount exceeds the money in this goal. Available:");
  expect(submitted).toBe(0);
  await page.locator("#goal-movement-amount").fill("25");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.locator("#goal-movement-amount")).toHaveValue("");
  const refreshed = await (await page.request.get(`/api/finance/goals/${goal.id}`)).json();
  expect(refreshed.goal.saved_cents).toBe(0);
});

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
  await page.getByRole("tab", { name: "Accounts", exact: true }).click();
  await addAccount(page, cash, "123.45");
  await addAccount(page, asset, "456.78", "asset");
  await addAccount(page, device + " negative", "-10.01");
  await expect(page.getByText("Negative balance. Review this account.", { exact: true }).first()).toBeVisible();
  const expected = { money: before.money.balance_cents + 11344, assets: before.assets.balance_cents + 45678 };
  const position = await (await page.request.get("/api/finance/summary")).json();
  expect(position.money.balance_cents).toBe(expected.money);
  expect(position.assets.balance_cents).toBe(expected.assets);

  await page.getByRole("button", { name: "View " + cash, exact: true }).click();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await expect(page.getByLabel("Account type", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Opening balance (PHP)", { exact: true })).toBeDisabled();
  if (device === "mobile") expect((await page.getByRole("dialog", { name: "Edit account", exact: true }).boundingBox())?.width).toBe(390);
  await page.getByLabel("Account name", { exact: true }).fill(wallet);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Accounts", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "View " + wallet, exact: true }).click();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await page.getByRole("button", { name: "Archive account", exact: true }).click();
  await expect(page.getByRole("button", { name: "View " + wallet, exact: true })).toHaveCount(0);
  expect((await (await page.request.get("/api/finance/summary")).json()).money.balance_cents).toBe(expected.money);
  await page.getByLabel("Show archived accounts").check();
  await page.getByRole("button", { name: "View " + wallet, exact: true }).click();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await page.getByRole("button", { name: "Restore account", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "View " + wallet, exact: true }).click();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill(wallet + " changed");
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
  for (const tab of ["History", "Planning", "Overview"]) await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByTestId("finance-money-total")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId("finance-asset-total")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const device of ["desktop", "mobile"]) test(device + " planned activity posts once, then Delete preserves and Revert reopens", async ({ page }) => {
  await page.setViewportSize(device === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await authenticate(page);
  if (device === "mobile") {
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Finance", exact: true }).click();
  } else await page.getByRole("link", { name: "Finance", exact: true }).click();
  await page.getByRole("tab", { name: "Accounts", exact: true }).click();
  const cash = device + " planned cash";
  await addAccount(page, cash, "500.00");
  const balance = async () => (await (await page.request.get("/api/finance/accounts")).json()).accounts
    .find((row: { name: string }) => row.name === cash).balance_cents;
  expect(await balance()).toBe(50000);

  await page.getByRole("tab", { name: "Planning", exact: true }).click();
  await page.getByRole("button", { name: "Add plan", exact: true }).click();
  await page.locator("#plan-amount").fill("35.50");
  await page.getByLabel("Expected account", { exact: true }).selectOption({ label: cash });
  await chooseFinanceDate(page, "Due date", "2026-10-02");
  await page.locator("#plan-text").fill(device + " expected expense");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Plan saved. Balances unchanged.", { exact: true })).toBeVisible();
  expect(await balance()).toBe(50000);

  const plans = await (await page.request.get("/api/finance/plans?status=pending&include_details=true")).json();
  const plan = plans.plans.find((row: { text: string }) => row.text === device + " expected expense");
  expect(plan.amount_cents).toBe(3550);

  // Scope by text so a sibling device's identically priced plan in the shared vault cannot match.
  await page.getByRole("button", { name: /^Review expense plan PHP 35\.50/ })
    .filter({ hasText: device + " expected expense" }).click();
  await page.getByRole("button", { name: "Post actual activity", exact: true }).click();
  await page.getByLabel("Actual account", { exact: true }).selectOption({ label: cash });
  await chooseFinanceDate(page, "Actual transaction date", "2026-10-04");
  await page.getByRole("button", { name: "Confirm and post", exact: true }).click();
  await expect(page.getByText("Actual activity posted once. Account balance: PHP 464.50.", { exact: true })).toBeVisible();
  expect(await balance()).toBe(46450);

  const posted = await (await page.request.get(`/api/finance/plans/${plan.id}`)).json();
  expect(posted.plan.status).toBe("satisfied");
  const retry = await page.request.post(`/api/finance/plans/${plan.id}/post`, { data: { request_id: randomUUID(), version: posted.plan.version, account_id: posted.plan.account_id, amount: "35.50", transaction_date: "2026-10-04" } });
  expect(retry.status()).toBe(409);
  expect(await balance()).toBe(46450);

  await page.getByRole("tab", { name: "History", exact: true }).click();
  // The vault is shared across specs, so scope to this device's own account row.
  await page.getByRole("button", { name: new RegExp(`Inspect expense PHP 35\\.50 on 2026-10-04`) })
    .filter({ hasText: cash }).click();
  await page.getByRole("button", { name: "Delete (hide)", exact: true }).click();
  await page.getByRole("button", { name: "Delete (hide only)", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Hidden from default History");
  const hidden = await (await page.request.get(`/api/finance/activity/${posted.plan.transaction_id}`)).json();
  expect(hidden.transaction.hidden).toBe(true);
  expect(hidden.transaction.reverted).toBe(false);
  expect(await balance()).toBe(46450);
  expect((await (await page.request.get(`/api/finance/plans/${plan.id}`)).json()).plan.status).toBe("satisfied");

  await page.getByRole("button", { name: "Revert", exact: true }).click();
  await page.getByRole("button", { name: "Revert effects", exact: true }).click();
  await expect(page.getByText(/^Activity reverted\./)).toBeVisible();
  expect(await balance()).toBe(50000);
  const reopened = await (await page.request.get(`/api/finance/plans/${plan.id}`)).json();
  expect(reopened.plan.status).toBe("pending");
  expect(reopened.plan.transaction_id).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
