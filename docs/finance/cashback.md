# Expense cashback

Add transaction offers **Off**, **%**, and **Amount** for expenses. Cashback
defaults to Off and resets to Off for a new form or after Save and add another.
Income and transfer entries do not offer cashback.

When enabled, cashback creates a separate income transaction in the active
**Cashback** income category, on the expense's account and date. The expense
remains gross spending; cashback counts as income. Both entries, their link, and
the audit record are saved atomically under one request ID.

Percentages accept up to two decimal places, at most 100%. Cashback rounds to the
nearest cent, with half-cents rounded up. The resulting credit must be at least
one cent and cannot exceed the expense. The form previews the income amount.

Correct the original expense to move both entries to another account/date or
change the expense amount. Percentage cashback recalculates; fixed cashback
stays fixed, and a correction below that fixed amount is rejected. Reverting the
expense cancels both effects. Delete hides the pair without changing balances.
Cashback income cannot be independently corrected or reverted. Refunds retain
their existing separate behavior.

REST expense posting and MCP `post_finance_transaction` accept optional
`cashback: { mode: "percent" | "amount", value: "5.00" }`. Omit it for Off.
Responses include the linked `cashback` income transaction when present.

## Manual browser check

Use a clearly named test account; these checks create persistent history.

1. Open Add transaction. Confirm Off is selected and no cashback input appears.
2. Enter a PHP 100 expense, select %, and enter 5. Confirm the preview is PHP 5.
   Save and inspect separate expense 100 and Cashback income 5 on the same date.
3. Repeat with Amount. Confirm the credit equals the entered PHP amount.
4. Use Save and add another, then change transaction type. Confirm cashback resets
   to Off and is unavailable for income/transfers.
5. Correct and revert the original expense. Confirm both entries stay linked and
   account balances and monthly totals reflect both effects exactly once.
