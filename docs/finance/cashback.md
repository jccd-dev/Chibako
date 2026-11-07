# Expense cashback

Add transaction offers **Off**, **%**, and **Amount** for expenses. Cashback
resets to Off for a new form or Save and add another. Income and transfer entries
do not offer cashback.

Cashback is earned as **pending**. It does not reduce card debt or count as
income until the bank credits it. A PHP 5,000 purchase with 1% cashback leaves
PHP 5,000 owed and PHP 50 pending. Paying PHP 5,000 early leaves the reward
pending. Applying PHP 50 on statement day reduces that statement to PHP 4,950.
Enter the actual credited date and receiving money or credit account; issuer
rules are not calculated automatically.

Percentages accept up to two decimal places, at most 100%. Cashback rounds to
the nearest cent, half up. The result must be at least one cent and cannot exceed
the expense. The preview shows the earned amount.

Applying all or part creates separate dated income in the active **Cashback** category. The
expense remains gross spending. Un-applying cancels that income and returns the
reward to pending; undo reverses all active applications for that expense, and audit history remains. Correcting the original expense
recalculates percentage rewards; fixed rewards stay fixed and cannot exceed
the corrected expense. Actual applied amounts and destinations are preserved; reducing the earned reward below its applied total is rejected until applications are undone. Applied rewards retain their bank credited date when
the purchase date changes. Correct the cashback income's date to fix a mistaken
credited date. Reverting the expense cancels its reward and any applied income.
Delete hides the expense and applied income without changing balances. Existing
cashback with linked income remains applied after upgrade.

REST posting and MCP `post_finance_transaction` accept optional
`cashback: { mode: "percent" | "amount", value: "5.00", account_id?: "..." }`.
Omit it for Off. `account_id` selects the default destination; otherwise the
expense account is used. Expense responses expose `cashback_mode`,
`cashback_value`, `cashback_amount_cents`, `cashback_account_id`, and
`cashback_transaction_id` (null while pending). A reverted expense's reward is
cancelled, even though its original metadata stays visible in history.

Apply with `POST /api/finance/activity/:id/cashback` or MCP
`apply_finance_cashback`, supplying `request_id`, current expense `version`,
`transaction_date`, optional PHP decimal `amount` (defaults to the remaining pending reward), and optional `account_id`. Credit dates must be on or after the purchase and no later than today. Responses include `cashback_applied_cents`, `cashback_pending_cents`, and active `cashback_applications`; `cashback_transaction_id` remains the latest application for compatibility. Un-apply with `DELETE` at the same
REST URL or MCP `unapply_finance_cashback`, supplying `request_id` and current
expense `version`. MCP also takes expense `id`. Both require `finance:write`,
bump the expense version, and save the financial effect and audit atomically.
Identical retries return the original result; stale versions are rejected.

## Manual browser check

Use a disposable vault and a clearly named card and payment account.

1. Record a PHP 5,000 card expense with 1% cashback. Confirm PHP 50 pending and
   PHP 5,000 owed, with no cashback income.
2. Apply the reward on the statement date. Confirm PHP 50 income and PHP 4,950
   statement balance. Un-apply and confirm the original debt and pending reward.
3. On another expense, pay the card in full before applying its reward. Confirm
   the reward remains pending.
4. Correct and revert the expense. Confirm percentage recalculation, credited
   date preservation, and cancellation of both the expense and applied reward.
