import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const PASSWORD = "correct horse battery staple";
test.setTimeout(120_000);

async function authenticate(page: Page) {
  const clientId = randomUUID();
  await page.route("**/api/login", route => route.continue({ headers: { ...route.request().headers(), "x-chibako-client-ip": clientId } }));
  await page.goto("/");
  if (/\/setup/.test(page.url())) {
    await page.locator("#setup-password").fill(PASSWORD);
    await page.locator("#setup-confirm").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
  } else if (/\/login/.test(page.url())) {
    await page.locator("#login-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app/);
}

async function addAccount(page: Page, name: string, balance: string) {
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill(name);
  await page.getByLabel("Account type", { exact: true }).selectOption("money");
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill(balance);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Manage ${name}`, exact: true })).toBeVisible();
}

type Note = { id: string; title: string; content: string; created_at: number; updated_at: number };

async function createNote(page: Page, title: string, content: string): Promise<Note> {
  const response = await page.request.post("/api/notes", { data: { title, content } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).note as Note;
}

async function readNote(page: Page, id: string): Promise<Note> {
  const response = await page.request.get(`/api/notes/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).note as Note;
}

async function accountBalance(page: Page, id: string) {
  const { accounts } = await (await page.request.get("/api/finance/accounts")).json() as { accounts: { id: string; balance_cents: number }[] };
  return accounts.find(account => account.id === id)!.balance_cents;
}

async function expenseId(page: Page, accountId: string, amountCents: number, date: string) {
  const { transactions } = await (await page.request.get(`/api/finance/activity?limit=25&account_id=${accountId}`)).json() as { transactions: { id: string; amount_cents: number; transaction_date: string }[] };
  const row = transactions.find(item => item.amount_cents === amountCents && item.transaction_date === date);
  expect(row).toBeTruthy();
  return row!.id;
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function openEntryDetails(page: Page) {
  if (!(await page.getByLabel("Find a Note by title", { exact: true }).isVisible())) {
    await page.getByText("Additional details", { exact: true }).click();
  }
}

async function expandLinksPanel(scope: Locator) {
  const summary = scope.getByText("Additional details: Note links", { exact: true });
  const open = await summary.evaluate(element => (element.closest("details") as HTMLDetailsElement | null)?.open === true);
  if (!open) await summary.click();
}

async function pickNote(page: Page, title: string) {
  await page.getByLabel("Find a Note by title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Find Notes", exact: true }).click();
  await page.getByRole("button", { name: `Select Note ${title}`, exact: true }).click();
}

for (const device of ["desktop", "mobile"]) {
  test(`${device} finance Note links owner workflow`, async ({ page }) => {
    await page.setViewportSize(device === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    await authenticate(page);
    await page.goto("/app/finance?tab=manage");

    const stamp = Date.now().toString(36);
    const account = `${device} note cash`;
    await addAccount(page, account, "100.00");
    const accountId = (await (await page.request.get("/api/finance/accounts")).json() as { accounts: { id: string; name: string }[] }).accounts.find(row => row.name === account)!.id;

    const note = await createNote(page, `Ticket 05 synthetic Note ${device} ${stamp}`, `Synthetic content ${stamp}. Finance never edits this.`);
    const before = await readNote(page, note.id);
    const longTitle = `Ticket 05 long ${device} ${stamp} ` + "Very long note title that must wrap ".repeat(4);
    await createNote(page, longTitle, "Long content ".repeat(200));
    const trashedTitle = `Ticket 05 trashed ${device} ${stamp}`;
    const trashed = await createNote(page, trashedTitle, "trashed body");
    expect((await page.request.delete(`/api/notes/${trashed.id}`)).ok()).toBeTruthy();

    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await page.getByLabel("Filter account", { exact: true }).selectOption(accountId);
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();

    // Step 2: record an expense, find, inspect and select the synthetic Note.
    await page.getByRole("button", { name: "Add transaction", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Amount (PHP)", { exact: true }).fill("12.34");
    await page.getByLabel("Account", { exact: true }).selectOption({ label: account });
    await page.getByLabel("Transaction date", { exact: true }).fill("2026-10-03");
    await openEntryDetails(page);
    await page.getByLabel("Transaction text", { exact: true }).fill("synthetic note-link expense");

    const searchBox = page.getByLabel("Find a Note by title", { exact: true });
    const noMatches = page.getByText("No matching Notes outside Trash. Try another title.");
    await searchBox.fill(`missing ${stamp}`);
    await page.getByRole("button", { name: "Find Notes", exact: true }).click();
    await expect(noMatches).toBeVisible();
    await searchBox.fill("%");
    await page.getByRole("button", { name: "Find Notes", exact: true }).click();
    await expect(noMatches).toBeVisible();
    await searchBox.fill(trashedTitle);
    await page.getByRole("button", { name: "Find Notes", exact: true }).click();
    await expect(noMatches).toBeVisible();

    await searchBox.fill(note.title);
    await page.getByRole("button", { name: "Find Notes", exact: true }).click();
    await expect(page.getByRole("list", { name: "Note search results" })).toContainText(note.title);
    await page.getByRole("button", { name: `Inspect candidate Note ${note.title}`, exact: true }).click();
    const inspection = page.getByRole("region", { name: "Read-only Note inspection" });
    await expect(inspection).toContainText(note.content);
    await page.getByRole("button", { name: "Close Note inspection", exact: true }).click();
    await expect(inspection).toHaveCount(0);
    await page.getByRole("button", { name: `Select Note ${note.title}`, exact: true }).click();
    await expect(page.getByText("Selected Notes (1/20)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save transaction", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Filter account", { exact: true })).toHaveValue(accountId);
    expect(await accountBalance(page, accountId)).toBe(8766);
    expect(await page.getByRole("button", { name: "Inspect expense PHP 12.34 on 2026-10-03", exact: true }).count()).toBe(1);

    // Step 3: inspect, remove, save links; balance stays put and removal persists.
    const inspectExpense = async () => {
      await page.getByRole("button", { name: "Inspect expense PHP 12.34 on 2026-10-03", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    };
    await inspectExpense();
    const sheet = page.getByRole("dialog");
    await expandLinksPanel(sheet);
    await expect(sheet.getByText("Selected Notes (1/20)", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: `Inspect Note ${note.title}`, exact: true }).click();
    await expect(sheet.getByRole("region", { name: "Read-only Note inspection" })).toContainText(note.content);
    await sheet.getByRole("button", { name: "Close Note inspection", exact: true }).click();
    await sheet.getByRole("button", { name: `Remove Note link ${note.title}`, exact: true }).click();
    await expect(sheet.getByText("Selected Notes (0/20)", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Save Note links", exact: true }).click();
    await expect(page.getByText(/Note links saved/)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Close details", exact: true })).toBeEnabled();
    expect(await accountBalance(page, accountId)).toBe(8766);
    await sheet.getByRole("button", { name: "Close details", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await inspectExpense();
    await expandLinksPanel(sheet);
    await expect(sheet.getByText("No Note links selected.", { exact: true })).toBeVisible();

    // Step 4: attach again; Note content/date unchanged, transaction text stays on finance.
    await pickNote(page, note.title);
    await sheet.getByRole("button", { name: "Save Note links", exact: true }).click();
    await expect(page.getByText(/Note links saved/)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Close details", exact: true })).toBeEnabled();
    const after = await readNote(page, note.id);
    expect(after.content).toBe(before.content);
    expect(after.created_at).toBe(before.created_at);
    expect(after.updated_at).toBe(before.updated_at);
    await sheet.getByRole("button", { name: "Close details", exact: true }).click();
    await inspectExpense();
    await expandLinksPanel(sheet);
    await expect(sheet.getByText("Selected Notes (1/20)", { exact: true })).toBeVisible();
    await expect(sheet.locator("dd", { hasText: "synthetic note-link expense" })).toBeVisible();
    expect(await accountBalance(page, accountId)).toBe(8766);

    // Step 5: Save and add another clears the Note selection; cancel the next entry.
    await sheet.getByRole("button", { name: "Close details", exact: true }).click();
    await page.getByRole("button", { name: "Add transaction", exact: true }).click();
    await page.getByLabel("Amount (PHP)", { exact: true }).fill("1.11");
    await page.getByLabel("Account", { exact: true }).selectOption({ label: account });
    await page.getByLabel("Transaction date", { exact: true }).fill("2026-10-04");
    await openEntryDetails(page);
    await pickNote(page, note.title);
    await expect(page.getByText("Selected Notes (1/20)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save and add another", exact: true }).click();
    await expect(page.getByLabel("Amount (PHP)", { exact: true })).toHaveValue("");
    await expect(page.getByText("Selected Notes (0/20)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await accountBalance(page, accountId)).toBe(8655);

    // Step 6: keyboard Find/Select, Escape discards an unsaved selection, long content wraps.
    await page.getByRole("button", { name: "Add transaction", exact: true }).click();
    await openEntryDetails(page);
    await searchBox.focus();
    await searchBox.fill(longTitle);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Note search results" })).toContainText("Ticket 05 long");
    if (device === "mobile") await page.setViewportSize({ width: 320, height: 844 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.getByRole("button", { name: `Select Note ${longTitle}`, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Selected Notes (1/20)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Inspect Note ${longTitle}`, exact: true }).click();
    await expect(page.getByRole("region", { name: "Read-only Note inspection" })).toContainText("Long content");
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.getByRole("button", { name: "Close Note inspection", exact: true }).click();
    await page.getByRole("button", { name: `Remove Note link ${longTitle}`, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Add transaction", exact: true }).click();
    await openEntryDetails(page);
    await expect(page.getByText("Selected Notes (0/20)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    // Step 7: picker failure/retry, loading feedback, then stale-version recovery.
    await page.getByRole("button", { name: "Add transaction", exact: true }).click();
    await openEntryDetails(page);
    const failNotes = (route: Route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Notes unavailable" }) });
    await page.route("**/api/finance/notes**", failNotes);
    await searchBox.fill(note.title);
    await page.getByRole("button", { name: "Find Notes", exact: true }).click();
    await expect(page.getByText(/Notes unavailable Try Find Notes again\./)).toBeVisible();
    await page.unroute("**/api/finance/notes**", failNotes);
    const slowNotes = async (route: Route) => { await new Promise(resolve => setTimeout(resolve, 400)); await route.continue(); };
    await page.route("**/api/finance/notes**", slowNotes);
    await page.getByRole("button", { name: "Find Notes", exact: true }).click();
    await expect(page.getByText("Finding Notes…", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Note search results" })).toContainText(note.title);
    await page.unroute("**/api/finance/notes**", slowNotes);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    const expense = await expenseId(page, accountId, 1234, "2026-10-03");
    await inspectExpense();
    const current = (await (await page.request.get(`/api/finance/activity/${expense}?include_details=true`)).json() as { transaction: { version: number } }).transaction;
    const concurrent = await page.request.put(`/api/finance/activity/${expense}/notes`, { data: { request_id: randomUUID(), version: current.version, note_ids: [] } });
    expect(concurrent.ok()).toBeTruthy();
    await expandLinksPanel(sheet);
    await expect(sheet.getByText("Activity changed. Refresh transaction details before changing Note links.")).toBeVisible();
    await sheet.getByRole("button", { name: "Refresh transaction details", exact: true }).click();
    await expect(sheet.getByText("Activity changed. Refresh transaction details before changing Note links.")).toBeHidden();
    await expandLinksPanel(sheet);
    await expect(sheet.getByText("No Note links selected.", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Close details", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    expect(errors).toEqual([]);
  });
}
