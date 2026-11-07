# Credit card statements and payments

Card expenses are assigned by transaction date to monthly billing cycles. With a cutoff on the 15th and a fixed due day of 5, October 16–November 15 purchases form one total due December 5. The expected SOA issue date is the day after cutoff. Individual purchases remain in Activity.

The card statement view shows the upcoming estimate before cutoff and retains older cycles. Each cycle shows its dates, statement total including carried balances, and remaining amount attributed to that cycle. Payments and credits settle the oldest outstanding amounts first. Carried principal is counted once across cycle reminders; a later statement total may include that carried principal.

The card drawer has no bank-statement form: logged purchases are assigned to cycles and due dates automatically. Bank confirmation is an optional fallback through the API/MCP (`confirm_finance_statement`) for reconciling to an actual SOA; existing confirmations stay and are shown read-only. A confirmed cutoff, balance, minimum and due date from the bank apply as follows. The actual cutoff is associated with the nearest configured cutoff (ties use the earlier cutoff), including shifts across month-end. It replaces that estimated cycle. Correcting the cutoff supersedes the prior confirmation for the same cycle; the old metadata remains in the audit. Bank figures override estimates without inventing missing charges or changing account balances. Record missing interest and fees as card expenses. Chibako does not calculate bank interest, minimum formulas, or holiday adjustments.

Unpaid cycle reminders stay visible until covered. A confirmed minimum is reduced by actual credits after that cutoff, even when those credits settle older principal. After the due date, an unpaid confirmed minimum is overdue; a paid minimum with a remaining full balance produces a warning. Unconfirmed cycles use the estimated full balance.

## Record a payment

In the card statement, choose a cycle, then select Record payment to open the payment dialog and choose a cash account. The linked payment account is selected by default. The cash amount defaults to the remaining balance, less any selected cashback until you edit the amount. Enter the actual payment date. Partial, early, and cashback-only settlements are supported.

Cashback defaults off. Select pending rewards and the actual amount and credited date for each. Previously applied rewards are already in the balance and cannot be excluded by this control. A PHP 5,000 bill with PHP 100 pending can be settled with PHP 5,000 cash and rewards untouched, or PHP 4,900 cash plus PHP 100 actually credited. Partial application of PHP 40 leaves PHP 60 pending.

If a selected reward was credited on or before a confirmed cutoff, that bank statement already includes it. The form records the missing credit in Chibako but does not discount the cash due a second time. Its preview distinguishes the reduction in the recorded card balance from settlement of the confirmed statement.

Payment records a transfer internally; it is not another expense. Cash and selected cashback save atomically. The preview explains allocation to older statements before the selected statement. This records bank activity; it does not execute a bank payment or schedule auto-debit.

Future card repayment and cashback dates are rejected, including ordinary transfers into cards and date corrections. Existing future-dated records are not automatically altered. Other finance transaction date rules remain unchanged.

## Interfaces

- `GET /api/finance/accounts/:id/cycles`, MCP `get_finance_credit_cycles`: cycles, pending card rewards, active money accounts; requires `finance:read`.
- `POST /api/finance/accounts/:id/payment`, MCP `record_finance_card_payment`: `request_id`, account `version`, cutoff `statement_date`, cash `amount` as a PHP decimal, `transaction_date`, and `source_account_id` for positive cash. Optional `cashbacks` entries contain `expense_id`, expense `version`, PHP `amount`, and actual credited `transaction_date`. Zero cash requires at least one positive reward. Requires `finance:write`; returns account, payment and cashback results atomically. Identical retries replay; stale account/reward versions reject.
- `POST /api/finance/accounts/:id/statement`, MCP `confirm_finance_statement`: `request_id`, account `version`, cutoff `statement_date`, PHP `balance`, `minimum_due`, and `due_date`. Requires `finance:write`. Minimum cannot exceed balance; due cannot precede cutoff. Metadata and account versions increment on confirmation.

MCP interfaces also take account `id`. Authorization and business rules are shared with REST. Schema 8 adds cashback application history while preserving previously applied income.
