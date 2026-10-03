# Ticket 03 manual owner-flow checks

Browser E2E is owner-run for this ticket on your existing dev server. Open
`/app/finance` at your usual dev URL; no new server, vault or build directory is
needed for your manual pass.

These actions persist real activity in that dev vault. Back it up first if its
data matters. Use clearly named test accounts (for example, `TEST 03 Cash`,
`TEST 03 Bank`, `TEST 03 Bike`) and a new test expense category. Substitute those
names throughout the steps below. Use synthetic values, not personal accounts.

If the vault already has finance history, compare Overview money/asset totals
and monthly income/spending to their starting values: the totals below describe
the test accounts only. Do not expect global totals to equal them. Filter
Activity to your test accounts/category when inspecting records. Archived test
accounts retain balances and reporting effects; archiving is not cleanup or an
undo. Do not directly delete ledger rows to clean up.

This owner-selected manual target does not authorize agents or automated tests
to mutate your running dev vault. Automated verification remains isolated.

## Worked example

1. In Manage create money accounts **Cash** (PHP 100.00) and **Bank** (PHP 0.00),
   asset **Bike** (PHP 500.00), and expense category **Bank fees**.
2. In Activity set an October 2026 date filter. Add transaction must default to
   Expense. Switch to Transfer: source Cash, destination Bank, amount 25.01,
   date 2026-10-03. Include a fee of 1.50, category Bank fees, and optional text.
3. Save. Verify the tab and filters remain. The result notice and Overview must
   show Cash **73.49**, Bank **25.01**, total money **98.50**, assets **500.00**.
   October income must be **0.00** and spending **1.50**.
4. Activity must show one transfer and one separate fee expense. Inspect the
   transfer: both account names and date must be present, text only in details.
   Inspect fee and Inspect transfer must navigate between the linked records.
   Filter by Transfer and by Bank: the transfer must remain visible. Filter
   Expense / Bank fees: only the fee appears.
5. In Manage choose Reconcile Cash. Current derived balance is **73.49**. Enter
   actual **70.00**, date 2026-09-30. Preview must show **-3.49**. Record it.
   Cash becomes **70.00**, the opening remains **100.00**, and neither September
   nor October income/spending gains an adjustment. Inspect Reconciliation:
   verify derived 73.49, actual 70.00, difference -3.49 and date.
6. Choose Adjust value for Bike: actual **650.50**, date 2026-10-01. Preview
   **150.50**; save. Asset total becomes **650.50**, cash stays **95.01** and
   October spending stays **1.50**. Inspect and filter Asset valuation.
7. Add a 100.00 Cash-to-Bank transfer without a fee, dated 2026-10-04. Cash
   becomes **-30.00**, Bank **125.01**. The save succeeds with a negative warning;
   cash total stays **95.01** and spending stays **1.50**.

## Validation and recovery

- Empty amount/account/date, zero/negative transfer, extra decimal precision,
  same source/destination, missing fee category and zero fee must not post.
  Asset and archived accounts must not be selectable for transfers. A validation
  error should identify the field and retain entries.
- Save and add another must retain source/destination/date/type and fee category,
  clearing transfer amount, fee amount and additional text/tags. Cancel/Escape
  closes the sheet without posting. Reopening defaults to Expense.
- Open reconciliation in one browser tab. Post an expense for that account in
  another tab, then save the old comparison. It must reject the changed balance,
  retain entries, and offer Refresh balance. Refresh, review the new difference
  and save once.
- To check an ambiguous success, use developer tools to interrupt a POST response
  after the server commits (not just before sending). Retry unchanged entries:
  expect the original result and one effect/fee pair, never duplicate effects.
  If the interruption cannot reliably hit this window, rely on the automated
  capability/protocol retry checks rather than claiming a browser result.
- Block history/options/totals/account-detail requests with developer tools:
  verify error feedback and Retry/Refresh recovery. An empty filter must show a
  useful empty state; loading should not show stale inspection details.

## Responsive/accessibility pass

Repeat the entry, reconciliation, valuation and inspection steps at desktop and
390px mobile width, in light and dark modes. Expect a desktop side panel and
mobile full-width sheet; no horizontal overflow, clipped money values or
unreachable bottom actions. Try a long account name. Use Tab/Shift+Tab, Enter,
Space and Escape throughout: visible focus, labelled fields, usable fee toggle,
linked inspection buttons and a closable sheet. Check the console for errors.

Record pass/fail and any screenshots when reporting back. These steps are the
manual acceptance gate; they have not been claimed as executed by the agent.
