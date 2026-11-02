import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chooseFinanceDate } from "./finance-date-controls";

async function pickAccount(page: Page, group: string, name: string) {
  const choice = page.getByRole("radiogroup", { name: group, exact: true });
  await choice.waitFor();
  const tile = choice.locator("label", { hasText: name }).first();
  // Long account lists collapse behind "Show N more".
  if (!(await tile.count())) await page.getByRole("button", { name: /^Show \d+ more$/ }).first().click();
  await tile.click();
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

// Finance sections are sidebar links driven by ?tab=; the mobile sidebar is collapsed, so navigate by URL.
async function openFinanceTab(page: Page, tab: "overview" | "activity" | "planning" | "accounts") {
  await page.goto(`/app/finance?tab=${tab}`);
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
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
  const row = page.getByRole("button", { name: new RegExp(`^Edit goal ${goal.name}:`) });
  await expect(row).toContainText("25%");
  await row.click();
  await page.getByLabel("Action", { exact: true }).selectOption("withdrawal");
  await pickAccount(page, "Destination account", account.name);
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
  // Money went back to its source, so the mistaken goal can be deleted for good.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(row).toHaveCount(0);
  expect((await page.request.get(`/api/finance/goals/${goal.id}`)).status()).toBe(404);
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
  // The vault is shared across runs, so suffix names to keep "View <name>" unique.
  const run = randomUUID().slice(0, 8);
  const cash = `${device} cash ${run}`, wallet = `${device} wallet ${run}`, asset = `${device} asset ${run}`;
  await openFinanceTab(page, "accounts");
  await addAccount(page, cash, "123.45");
  await addAccount(page, asset, "456.78", "asset");
  await addAccount(page, `${device} negative ${run}`, "-10.01");
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
  await expect(page).toHaveURL(/[?&]tab=accounts\b/);
  await page.getByRole("button", { name: "View " + wallet, exact: true }).click();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await page.getByRole("button", { name: "Archive account", exact: true }).click();
  await expect(page.getByRole("button", { name: "View " + wallet, exact: true })).toHaveCount(0);
  expect((await (await page.request.get("/api/finance/summary")).json()).money.balance_cents).toBe(expected.money);
  await page.getByRole("checkbox", { name: "Show archived accounts" }).check();
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
    await addAccount(page, `Maximum exact negative ${run}`, "-90071992547409.91");
    await page.setViewportSize({ width: 320, height: 844 });
  }
  for (const tab of ["activity", "planning", "overview"] as const) await openFinanceTab(page, tab);
  await expect(page.getByTestId("finance-money-total")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId("finance-asset-total")).toBeVisible();
  }
  if (device === "mobile") {
    // Leave no extreme balance behind: a second one in a shared vault overflows combined totals.
    const extreme = (await (await page.request.get("/api/finance/accounts?limit=100&archived=all")).json()).accounts
      .find((row: { name: string }) => row.name === `Maximum exact negative ${run}`);
    expect((await page.request.patch(`/api/finance/accounts/${extreme.id}`, { data: {
      request_id: randomUUID(), version: extreme.version, include_in_summary: false, archived: true,
    } })).ok()).toBe(true);
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
  await openFinanceTab(page, "accounts");
  const run = randomUUID().slice(0, 8);
  const cash = `${device} planned cash ${run}`, planText = `${device} expected expense ${run}`;
  await addAccount(page, cash, "500.00");
  const balance = async () => (await (await page.request.get("/api/finance/accounts")).json()).accounts
    .find((row: { name: string }) => row.name === cash).balance_cents;
  expect(await balance()).toBe(50000);

  await openFinanceTab(page, "planning");
  await page.getByRole("button", { name: "Add plan", exact: true }).first().click();
  // New plans default to recurring; this flow covers a one-time plan.
  await page.getByRole("switch", { name: "Set as recurring expense" }).click();
  await page.locator("#schedule-text").fill(planText);
  await page.locator("#schedule-amount").fill("35.50");
  await pickAccount(page, "Account", cash);
  await chooseFinanceDate(page, "Logged at", "2026-10-02");
  await page.getByRole("button", { name: "Save expense plan", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Plan saved. Balances unchanged.", { exact: true })).toBeVisible();
  expect(await balance()).toBe(50000);

  const plans = await (await page.request.get("/api/finance/plans?status=pending&include_details=true")).json();
  const plan = plans.plans.find((row: { text: string }) => row.text === planText);
  expect(plan.amount_cents).toBe(3550);

  await page.getByRole("button", { name: `Open ${planText}`, exact: true }).click();
  await page.getByRole("button", { name: "Log payment", exact: true }).click();
  await pickAccount(page, "Account", cash);
  await chooseFinanceDate(page, "Date paid", "2026-10-04");
  await page.getByRole("button", { name: "Confirm payment", exact: true }).click();
  await expect(page.getByText("Actual activity posted once. Account balance: PHP 464.50.", { exact: true })).toBeVisible();
  expect(await balance()).toBe(46450);

  const posted = await (await page.request.get(`/api/finance/plans/${plan.id}`)).json();
  expect(posted.plan.status).toBe("satisfied");
  const retry = await page.request.post(`/api/finance/plans/${plan.id}/post`, { data: { request_id: randomUUID(), version: posted.plan.version, account_id: posted.plan.account_id, amount: "35.50", transaction_date: "2026-10-04" } });
  expect(retry.status()).toBe(409);
  expect(await balance()).toBe(46450);

  await openFinanceTab(page, "activity");
  // The vault is shared across specs, so scope to this device's own account row.
  await page.getByRole("button", { name: "Inspect expense PHP 35.50 on Oct 4, 2026", exact: true })
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

test("credit accounts show card fields when added and list used and available credit", async ({ page }) => {
  await authenticate(page);
  await openFinanceTab(page, "accounts");
  const name = `TEST CREDIT card ${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill(name);
  await expect(page.getByLabel("Credit limit (PHP)", { exact: true })).toHaveCount(0);
  await page.getByLabel("Account type", { exact: true }).selectOption("credit");
  await expect(page.getByLabel("Opening balance (PHP)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Maintaining balance (PHP)", { exact: true })).toHaveCount(0);
  await page.getByLabel("Credit limit (PHP)", { exact: true }).fill("10000");
  await page.getByRole("checkbox", { name: "I already owe on this card", exact: true }).check();
  await page.getByLabel("Existing owed balance (PHP)", { exact: true }).fill("2500");
  await page.getByLabel("Statement day", { exact: true }).selectOption("25");
  await page.getByRole("button", { name: "Days after statement", exact: true }).click();
  await page.getByLabel("Days after statement", { exact: true }).selectOption("21");
  await expect(page.getByRole("status").filter({ hasText: "Used credit" })).toContainText("Used credit PHP 2,500.00 · Available PHP 7,500.00");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.locator("[data-slot=card]").filter({ has: page.getByRole("button", { name: "View " + name, exact: true }) });
  await expect(card).toContainText("Credit");
  await expect(card).toContainText("-PHP 2,500.00");
  await expect(card).toContainText("Used PHP 2,500.00 · Available PHP 7,500.00");
  await expect(card).not.toContainText("Negative balance");
  const { accounts } = await (await page.request.get("/api/finance/accounts?kind=credit&limit=100")).json();
  const saved = accounts.find((row: { name: string }) => row.name === name);
  expect([saved.statement_day, saved.due_mode, saved.due_value, saved.credit_limit_cents]).toEqual([25, "after_statement", 21, 1000000]);

  // Charge the card up to its available credit, then pay it from a money account.
  const cashName = `TEST CREDIT payer ${randomUUID().slice(0, 8)}`;
  expect((await page.request.post("/api/finance/accounts", { data: { request_id: randomUUID(), name: cashName, kind: "money", currency: "PHP", opening_balance: "1000" } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Amount (PHP)", { exact: true }).fill("7500.01");
  await pickAccount(page, "Account", name);
  await expect(page.getByRole("alert").filter({ hasText: "Over credit limit" })).toContainText(`${name} has PHP 7,500.00 available credit`);
  await expect(page.getByRole("button", { name: "Save transaction", exact: true })).toBeDisabled();
  await page.getByLabel("Amount (PHP)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("Used PHP 2,600.00 · Available PHP 7,400.00");

  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page.getByLabel("Amount (PHP)", { exact: true }).fill("600");
  await expect(page.getByLabel("Source account", { exact: true }).locator("option", { hasText: name })).toHaveCount(0);
  await pickAccount(page, "Source account", cashName);
  await pickAccount(page, "Destination account", name);
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("Used PHP 2,000.00 · Available PHP 8,000.00");
});

test("a card statement due reminder appears after a charge and clears once paid by transfer", async ({ page }) => {
  await authenticate(page);
  await openFinanceTab(page, "accounts");
  const name = `TEST CREDIT due ${randomUUID().slice(0, 8)}`;
  const cashName = `TEST CREDIT due payer ${randomUUID().slice(0, 8)}`;
  // Closing the statement today puts today's charge on it.
  const statementDay = new Date().getDate();
  const created = await page.request.post("/api/finance/accounts", { data: { request_id: randomUUID(), name, kind: "credit", currency: "PHP", opening_balance: "0", credit_limit: "5000", statement_day: statementDay, due_mode: "after_statement", due_value: 10 } });
  expect(created.ok()).toBe(true);
  const cardId = (await created.json()).account.id;
  expect((await page.request.post("/api/finance/accounts", { data: { request_id: randomUUID(), name: cashName, kind: "money", currency: "PHP", opening_balance: "1000" } })).ok()).toBe(true);
  const reminder = async () => ((await (await page.request.get("/api/finance/attention?limit=100")).json()).items as { reference_id: string; kind: string; title: string; amount_cents: number; urgency: string }[])
    .find(item => item.reference_id === cardId);
  await page.reload();
  const card = page.locator("[data-slot=card]").filter({ has: page.getByRole("button", { name: "View " + name, exact: true }) });
  await expect(card).toContainText("Next due");
  expect(await reminder()).toBeUndefined();

  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Amount (PHP)", { exact: true }).fill("300");
  await pickAccount(page, "Account", name);
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("PHP 300.00 due");
  expect(await reminder()).toMatchObject({ kind: "credit_due", title: name, amount_cents: 30000, urgency: "upcoming" });

  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page.getByLabel("Amount (PHP)", { exact: true }).fill("300");
  await pickAccount(page, "Source account", cashName);
  await pickAccount(page, "Destination account", name);
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toContainText("Next due");
  await expect(card).not.toContainText("PHP 300.00 due");
  expect(await reminder()).toBeUndefined();
});
