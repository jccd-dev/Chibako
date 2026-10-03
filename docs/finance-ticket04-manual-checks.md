# Ticket 04 manual owner-flow checks

Use your existing dev server at `/app/finance`, not a new server or vault.
These actions persist in that dev vault. Back up valuable data first. Use new
synthetic accounts **TEST 04 Cash**, **TEST 04 Bank**, **TEST 04 Other** (each
PHP 100.00) and expense categories **TEST 04 Food** and **TEST 04 Fees**. Do not
use personal accounts, directly delete ledger rows, or assume archiving undoes
activity. Agents/automated checks are not authorized to mutate this vault.

Existing history affects global totals. Record starting September/October 2026
income/spending and money totals; compare the deltas below. Use account/category
filters to distinguish these synthetic rows. All amounts below describe only
these test accounts and rows.

## Expense corrections, refunds and hiding

1. Add a Cash expense of **20.00**, Food, dated **2026-09-30**. Cash is **80.00**.
   Set Activity account Cash and September dates. Select the expense. The panel
   must show its details and editable fields, not a later-preview message.
2. Change amount to **30.00** and account to Bank. Save correction. Cash returns
   to **100.00**, Bank becomes **70.00**. The Activity tab and September/Cash
   filter remain; the corrected row no longer matches Cash. The panel must
   refresh to Bank without showing stale details. September spending gains
   **30.00**, October spending gains nothing.
3. Select Record refund. Receiving account Cash, amount **12.50**, date
   **2026-10-02**. Review refund must explain the credit, date and spending
   reduction before confirmation. Cancel must do nothing. Confirm it: Cash is
   **112.50**, Bank stays **70.00**. The refund links back to the original
   expense. September spending stays **30.00**; October spending changes by
   **-12.50**, income by **0.00**. Negative net October spending is valid.
4. Inspect original expense. Active refunds show **12.50**. Try reducing the
   expense to **12.49**, recording **17.51** more refund, or reverting it.
   Each must fail without any balance/report change and retain entries. A second
   refund of exactly **17.50** is accepted. Cash is **130.00**, active refunds
   are **30.00**, and October spending changes by **-30.00** in total.
5. On the original expense choose Delete (hide). Its confirmation must say the
   balances and reports stay unchanged. Confirm: Bank is still **70.00** and
   September spending still includes **30.00**. Default Activity excludes it.
   Set Hidden records to Hidden only and inspect it again. Hidden expenses can
   still have their effects corrected/reverted; hiding is not cancellation.
6. Find the refunds with type Refund and October dates (clear restrictive
   account/category filters if needed). Delete one: its credit and refund limit
   remain. Include hidden rows, then Revert both refunds. Each confirmation
   explains cancellation. Cash returns to **100.00**, October spending returns
   to the starting amount. Inspect the hidden original and Revert it. Bank
   returns to **100.00**; September spending returns to the starting amount.
7. Set both Hidden and Reverted filters to include all. Reverted records must
   remain inspectable with clear state. Edit/Revert are unavailable for a
   reverted record. Clear filters resets both flags to active, visible records.

## Transfers and adjustments

1. Cash to Bank transfer **20.00**, dated **2026-10-03**, with Fees expense
   **1.00**. Cash **79.00**, Bank **120.00**, Other **100.00**. Inspect transfer.
2. Correct source to Other, destination to Cash, amount **30.00**, fee **2.00**.
   Save together: Cash **130.00**, Bank **100.00**, Other **68.00**. Only fee
   spending **2.00** is added, not income or transfer spending. Correct the date
   and confirm the linked fee follows it. Inspect fee shows its new source/date.
3. Fee inspection must direct account/date changes and Revert to its linked
   transfer. Its amount/category remain editable. Revert transfer: all three
   accounts return to **100.00** and the fee spending is cancelled too. Refunds
   on a fee must be reverted before its transfer can be reverted.
4. Reconcile Other to **90.00**. Inspect the adjustment and correct its signed
   difference from **-10.00** to **-15.00**. Other is **85.00**. Move that
   adjustment to Cash: Other returns to **100.00**, Cash becomes **85.00**.
   Revert: Cash returns to **100.00**. Income/spending do not change.
5. If you have a clearly named synthetic asset from ticket 03, correct and
   revert its valuation similarly. Asset changes must never change cash totals
   or income/spending. Do not use a real asset to check this.

## Validation, retries and stale data

- Try zero/negative refund/expense/transfer amounts, malformed dates, same
  transfer endpoints and oversized amounts. They must not save. Labels/errors
  identify the problem and keep entries. A signed adjustment difference is
  allowed; a new unrestricted set-balance correction is not.
- Open an expense in two browser tabs. Save an edit or refund from one, then
  save the old version from the other. Expect a conflict, not an overwrite;
  close/reopen to refresh. Changing only amount must preserve text/tags/category.
- For an ambiguous response, interrupt it after the server commits using dev
  tools, then retry unchanged entries. One correction/refund/reversion only,
  with its original result. If this timing cannot be exercised reliably, use the
  automated capability/protocol retry evidence rather than claiming a browser
  pass. Revert with a new request must never cancel twice.
- Block detail, linked-fee or save requests: verify error feedback, Retry linked
  fee/Retry inspection, and safe resubmission. Closing cancels unsaved entry;
  saving must not switch tab or clear filters. Empty matches remain explained.

## Desktop, mobile and themes

Run the panel, confirmations, refund links, filters and error recovery at desktop
and 390px mobile width in light/dark mode. Expect a side panel on desktop and
full-width sheet on mobile; scroll reaches all actions, long names wrap, no
horizontal overflow. Use Tab/Shift+Tab, Enter/Space and Escape: labelled fields,
visible focus, confirmation cancel, and sheet close must work. Check the console.

Record pass/fail per step and any screenshots. These owner-flow checks are a
remaining manual acceptance gate, not checks the agent claims to have executed.
