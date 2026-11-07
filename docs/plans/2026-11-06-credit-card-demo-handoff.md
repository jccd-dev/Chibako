# Credit card sample journey handoff

The PH credit-card flow was implemented under [the implementation plan](2026-11-03-credit-card-ph-flow.md). A browser walkthrough then created persistent, clearly named sample records in JC's existing local vault. The walkthrough demonstrated the due-date payment branch, not an early payment. It also exposed a mismatch between current balance calculations and date-aware statement calculations.

## Billing cycle, explicitly

JC described cutoff on the 15th, SOA issued on the 16th, and payment due around the 5th of the following month. These are the user's stated schedule and observed cashback behavior, not independently verified issuer guarantees. The exact SOA due date takes precedence over the estimate.

| Purchase cycle | Cutoff | SOA issued | Estimated payment due |
| --- | --- | --- | --- |
| September 16–October 15, 2026 | October 15, 2026 | October 16, 2026 | November 5, 2026 |
| **October 16–November 15, 2026** | **November 15, 2026** | **November 16, 2026** | **December 5, 2026** |
| November 16–December 15, 2026 | December 15, 2026 | December 16, 2026 | January 5, 2027 |

The sample purchase on **October 30, 2026 belongs to the October 16–November 15 cycle**, with payment due approximately December 5. It does not belong to the cycle due November 5. This assumes the purchase is posted within the stated cycle; the bank's SOA decides actual inclusion.

In the current app, `statement_day = 15` means cutoff/closing day. There is no separate SOA-issued-date field. The demo used `due_mode = fixed_day`, `due_value = 5`; confirming the SOA overrides that estimate with its actual due date.

## Persistent demo accounts

Both accounts are in the group **Demo - Credit card flow** and excluded from total-balance/summary calculations. This exclusion does not isolate their activity from all reports.

| Account | Settings |
| --- | --- |
| DEMO Savings - Card walkthrough | Money/Debit; opening balance ₱10,000; maintaining balance ₱0 |
| DEMO Credit Card - 30000 limit | Credit; limit ₱30,000; opening debt ₱0; cutoff 15; fixed due day 5; payment account linked to demo Savings |

Existing real accounts were not selected for these mutations. No bank payment, redemption, or real auto-debit was executed. Chibako only recorded simulated activity. Transaction notes identify the purchase and transfer as demo records.

## What the browser walkthrough saved

| Step | Date entered | Record/action | Result observed |
| --- | --- | --- | --- |
| 1 | October 30, 2026 | One ₱5,000 Expense on demo card with 1% cashback | Card owed ₱5,000; available credit ₱25,000; cashback ₱50 pending |
| 2 | Same purchase | Automatic cash hold from linked demo Savings | Savings balance stayed ₱10,000; spendable cash became ₱5,000 |
| 3 | Statement date November 15, 2026 | Confirm statement: bank balance ₱5,000; sample minimum ₱500; due December 5, 2026 | Future statement saved; it was not the active statement on demonstration day, November 6 |
| 4 | December 5, 2026 | Inspect original expense and Apply cashback ₱50 to demo card | Separate cashback income created; displayed card debt became ₱4,950 |
| 5 | December 5, 2026 | Transfer ₱4,950 from demo Savings to demo card | Selecting the card destination filled the linked Savings source; displayed card debt became ₱0 |

The ₱500 minimum was an illustrative value, not an issuer formula or a value read from a real SOA. The confirmed balance was ₱5,000 because the demo applies cashback later, on December 5. If a real SOA already includes cashback, copy its actual net balance and record the cashback on its actual credited date.

Final observed demo account state: card debt ₱0, available credit ₱30,000, Savings balance and spendable cash ₱5,050. Card connected history contained exactly the demonstrated ₱5,000 expense, ₱50 cashback income, and ₱4,950 transfer. The card details drawer was left open for JC.

## Early payment versus cashback application

JC reports that paying early usually pays the full charge while the reward remains earned but unused. Waiting for auto-debit can let the bank offset cashback from that statement. Record the bank's actual credit/debit events rather than inferring reward usage from the payment date.

- **Early-payment alternative, not executed:** transfer ₱5,000 from Savings to the card on the actual payment date; leave ₱50 cashback pending while the bank has not credited it.
- **Due-date branch executed in the demo:** apply ₱50 on the simulated credited date, December 5; transfer ₱4,950 on December 5. Together they settle ₱5,000.
- Apply cashback records a bank credit; it does not instruct the bank to redeem rewards. Un-apply reverses Chibako's income effect and restores pending status; it does not reverse a bank credit.
- Repayment is one Transfer. It updates both accounts. Do not add another expense or manually duplicate the payment as card income.
- Cashback application is currently per expense. There is no payment-form checkbox for using rewards and no bulk statement cashback application.

## Why the screen showed November 5 and already-deducted cashback

The walkthrough took place on **November 6, 2026**. The last closed configured statement was October 15, due November 5. The November 15 confirmation was future-dated, so the statement display correctly continued selecting the older cycle. The displayed November 5 date was not the due date of the October 30 purchase. Its label was confusing because the old cycle had no remaining balance.

However, current net balances include saved transactions regardless of whether their transaction dates are in the future. The December 5 cashback and transfer immediately affected displayed debt, Savings, available credit, and cash holds. Statement remaining-balance/minimum calculations are date-aware and exclude credits after their as-of date. This created the misleading combination of an older active statement with balances already reflecting December settlement.

**Unresolved:** future-dated actual activity and statement displays use different effective-date rules. This behavior was explained to JC; it has not been fixed. The completed demo must not be treated as proof that date handling is ready for all workflows. No corrective edits, reversions, or demo cleanup were performed after JC questioned it.

For a real current-cycle entry, keep rewards pending until actually credited and log repayment when actually posted. For another completed-cycle demonstration, use a historical cycle that has already finished rather than future actual transactions.

## Code and verification handoff

- Repository HEAD observed while writing this handoff: `36b1b96`. Implementation remains uncommitted alongside unrelated work. Preserve other contributors' edits.
- Schema version is 7. The implementation plan has all three slices checked: pending cashback, linked payment-account holds/warnings, and confirmed statements/minimum due.
- Earlier implementation verification: 614 Node tests, 12 finance Playwright tests, typecheck, lint, MCP stdio, and isolated production build passed. These results preceded later concurrent work and are not a claim about every subsequent working-tree revision.
- Independent review found future payments reducing an earlier as-of minimum; that specific bug was reproduced and fixed by bounding statement credits to `asOf`. It did not change current net-balance treatment of future activity.
- Relevant owners: `src/features/finance/accounts.ts` for balances/holds/statement selection; `credit-statement.ts` for cutoff/due dates; `cashbacks.ts` for apply/un-apply; `statements.ts` for confirmation; `FinanceAccounts.tsx` and `FinanceCreditStatement.tsx` for due/statement presentation.
- No scheduled bank auto-debit execution, SOA-issued-date field, interest calculation, holiday adjustment, or unused-reward-expiry action exists.

The next session should read this handoff before changing or recreating demo records. A product decision is still needed on future actual transaction semantics and on how to label a previous, fully paid statement's due date. This handoff request authorizes documentation and memory retention; it does not authorize those behavior changes or deleting the demo history.

## Approved follow-up, November 7

JC subsequently approved [cycle totals and statement payments](2026-11-07-credit-card-cycle-payments.md). Upcoming cycle estimates and older unpaid statements are now implemented, with a statement payment form and optional partial cashback application. Future card repayments and cashback applications are rejected; this narrower rule does not change the dates or balance effects of the existing demo records above. Paid cycles no longer show a misleading next due date on the account card. The new plan records verification and any remaining manual-browser evidence. This section supersedes the unresolved product-decision status above; it does not imply the original demo was corrected or deleted.
