import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const mobile of [false, true]) {
  test(`overview compact money reveals exact cents on ${mobile ? "mobile tap" : "hover"}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    const page = await context.newPage();
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
    const accountName = `TEST compact ${randomUUID()}`;
    const created = await page.request.post("/api/finance/accounts", { data: {
      request_id: randomUUID(), name: accountName, kind: "money", currency: "PHP", opening_balance: "88400.99",
    } });
    expect(created.ok()).toBe(true);
    await page.route("**/api/finance/overview", async route => {
      const response = await route.fetch();
      const summary = await response.json();
      await route.fulfill({ json: { ...summary, money: { ...summary.money, balance_cents: 99999999 }, credit: { ...summary.credit, balance_cents: 0 } } });
    });
    await page.route("**/api/finance/reports?*", async route => {
      const response = await route.fetch();
      await route.fulfill({ json: { ...await response.json(), spending_cents: 123456789, unbudgeted_cents: 123456789 } });
    });
    await page.goto("/app/finance?tab=overview");
    await expect(page.getByTestId("finance-money-total")).toHaveText("PHP 999.9k");
    await expect(page.getByTestId("finance-expense-total")).toHaveText("PHP 1.2M");
    const trigger = page.getByTestId("finance-money-total").getByRole("button");
    if (mobile) await trigger.tap();
    else await trigger.hover();
    await expect(page.getByRole("dialog", { name: "Exact amount" })).toHaveText("PHP 999,999.99");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Exact amount" })).toHaveCount(0);
    const expensesCard = page.locator('[data-slot="card"]').filter({ has: page.getByText("Spending by category", { exact: true }) });
    const expenseTrigger = expensesCard.getByRole("button", { name: "PHP 1,234,567.89, show exact amount" }).first();
    await expect(expenseTrigger).toHaveText("PHP 1.2M");
    if (mobile) await expenseTrigger.tap();
    else await expenseTrigger.hover();
    await expect(page.getByRole("dialog", { name: "Exact amount" })).toHaveText("PHP 1,234,567.89");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Exact amount" })).toHaveCount(0);
    const accountCard = page.getByRole("button", { name: `View ${accountName}`, exact: true }).locator("..");
    const accountAmounts = accountCard.getByRole("button", { name: "PHP 88,400.99, show exact amount", exact: true });
    await expect(accountAmounts).toHaveCount(2);
    for (const amount of await accountAmounts.all()) {
      await expect(amount).toHaveText("PHP 88.4k");
      if (mobile) await amount.tap();
      else await amount.hover();
      await expect(page.getByRole("dialog", { name: "Exact amount" })).toHaveText("PHP 88,400.99");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Exact amount" })).toHaveCount(0);
    }
    const balanceRow = page.getByRole("list", { name: "Account balances" }).getByRole("listitem").filter({ hasText: accountName });
    await expect(balanceRow.getByRole("button")).toHaveText("PHP 88.4k");
    await accountCard.getByRole("button", { name: `View ${accountName}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await context.close();
  });
}
