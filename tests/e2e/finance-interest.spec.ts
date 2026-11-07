import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";

// The runner ticks every 60 seconds; backdating in the disposable vault stands in for elapsed days.
const RUNNER_WAIT = { timeout: 75_000, intervals: [2_000] };
const manilaDay = (daysAgo: number) => new Date(Date.now() + 8 * 3600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);

function backdate(accountId: string, day: string) {
  const dataDir = process.env.CHIBAKO_FIN_E2E_DATA_DIR;
  if (!dataDir) throw new Error("Interest browser checks need the disposable finance vault");
  const db = new Database(path.join(dataDir, "brain.db"));
  db.prepare("UPDATE finance_accounts SET created_at=? WHERE id=?").run(Date.parse(`${day}T00:00:00+08:00`) / 1000, accountId);
  db.prepare("UPDATE finance_interest_configurations SET start_date=? WHERE account_id=?").run(day, accountId);
  db.close();
}

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

async function openAccount(page: Page, name: string) {
  await page.goto("/app/finance?tab=accounts");
  await page.getByRole("button", { name: `View ${name}`, exact: true }).click();
}

async function createWithInterest(page: Page, name: string, interest: object) {
  const response = await page.request.post("/api/finance/accounts", { data: {
    request_id: randomUUID(), name, kind: "money", currency: "PHP", opening_balance: "1000", interest,
  } });
  expect(response.ok()).toBe(true);
  return (await response.json()).account as { id: string };
}

// Later finance specs share this vault, and account pickers collapse past six active accounts.
test.afterEach(async ({ page }) => {
  const { accounts } = await (await page.request.get("/api/finance/accounts?limit=100")).json() as { accounts: { id: string; name: string; version: number }[] };
  for (const account of accounts.filter(row => row.name.startsWith("TEST interest"))) {
    const archived = await page.request.patch(`/api/finance/accounts/${account.id}`, { data: { request_id: randomUUID(), version: account.version, archived: true } });
    expect(archived.ok()).toBe(true);
  }
});

for (const [device, width] of [["desktop", 1440], ["phone", 390]] as const) {
  test(`rate-only enable, optional payout and tax, persisted settings (${device})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await authenticate(page);
    const name = `TEST interest ${randomUUID().slice(0, 8)}`;
    await page.goto("/app/finance?tab=accounts");
    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByLabel("Account name", { exact: true }).fill(name);
    await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("1000");
    await expect(page.getByLabel("Interest payout", { exact: true })).toHaveCount(0);
    await page.getByLabel("Annual interest rate (%)", { exact: true }).fill("3.5");
    await expect(page.getByLabel("Interest payout", { exact: true })).toHaveValue("monthly");
    await expect(page.getByLabel("Withholding tax (%)", { exact: true })).toHaveValue("20");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await openAccount(page, name);
    const status = page.getByRole("region", { name: "Automatic interest" });
    await expect(status.getByText("3.5%", { exact: true })).toBeVisible();
    await expect(status.getByText("Monthly", { exact: true })).toBeVisible();
    await expect(status.getByText("20%", { exact: true })).toBeVisible();
    await expect(status.getByText("Next payout", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("button", { name: "Edit account", exact: true }).click();
    await page.getByLabel("Annual interest rate (%)", { exact: true }).fill("4.25");
    await page.getByLabel("Interest payout", { exact: true }).selectOption("quarterly");
    await page.getByLabel("Withholding tax (%)", { exact: true }).fill("10");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.reload();
    await openAccount(page, name);
    await expect(status.getByText("4.25%", { exact: true })).toBeVisible();
    await expect(status.getByText("Quarterly", { exact: true })).toBeVisible();
    await expect(status.getByText("10%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit account", exact: true }).click();
    await page.getByLabel("Withholding tax (%)", { exact: true }).fill("101");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Enter an annual rate and a 0 to 100 withholding tax", { exact: false })).toBeVisible();
  });
}

test("automatic credits, then a historical adjustment, appear in Activity", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await authenticate(page);
  const name = `TEST interest credit ${randomUUID().slice(0, 8)}`;
  const account = await createWithInterest(page, name, { annual_rate: "36.5", frequency: "daily", withholding_tax: "0" });
  const day = manilaDay(2);
  backdate(account.id, day);
  const balance = async () => (await (await page.request.get(`/api/finance/accounts/${account.id}`)).json()).account.balance_cents;
  // Two completed days of 1,000.00 at 0.1% a day.
  await expect.poll(balance, RUNNER_WAIT).toBe(100200);

  await openAccount(page, name);
  const history = page.getByRole("region", { name: "Account history" });
  await history.getByRole("button", { name: /^Inspect income PHP 1\.00/ }).first().click();
  await expect(page.getByText("Calculated by Chibako, not confirmed by your bank.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revert", exact: true })).toHaveCount(0);

  const posted = await page.request.post("/api/finance/activity", { data: {
    request_id: randomUUID(), type: "income", account_id: account.id, amount: "1000", transaction_date: day,
  } });
  expect(posted.ok()).toBe(true);
  // 1,000.00 more for the same two days, and the source income itself.
  await expect.poll(balance, RUNNER_WAIT).toBe(200400);
  await openAccount(page, name);
  await history.getByRole("button", { name: /^Inspect income PHP 1\.00/ }).first().click();
  await expect(page.getByText("Past activity changed this period's earnings", { exact: false })).toBeVisible();
});

test("disabling stops accrual and shows the scheduled final payout", async ({ page }) => {
  const day = manilaDay(1);
  test.skip(manilaDay(0).endsWith("-01-01"), "A yearly period closes on January 1");
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page);
  const name = `TEST interest off ${randomUUID().slice(0, 8)}`;
  const account = await createWithInterest(page, name, { annual_rate: "36.5", frequency: "yearly" });
  backdate(account.id, day);

  await openAccount(page, name);
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await page.getByLabel("Annual interest rate (%)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openAccount(page, name);
  const status = page.getByRole("region", { name: "Automatic interest" });
  await expect(status.getByText("Off", { exact: true })).toBeVisible();
  // One completed day at 0.1%, less 20% tax.
  await expect(status.getByText("PHP 0.80", { exact: true })).toBeVisible();
  await expect(status.getByText(`Jan 1, ${Number(day.slice(0, 4)) + 1}`, { exact: true })).toBeVisible();
  await expect(status.getByText("Final payout", { exact: true })).toBeVisible();
});
