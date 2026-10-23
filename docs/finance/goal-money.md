# Goal money

Adding money to a goal deducts it from the selected source account. An optional
linked money account receives it; otherwise the money stays held in the goal.
Unlinked savings remain included once in total money, outside account balances.
Goal movements do not create income or expenses and do not affect cash-flow reports.

Withdrawals reduce the goal balance and send money to a selected active money
account. For a linked goal, its linked account supplies the money. Choosing that
same account releases the goal holding without changing the account balance.
Changing or clearing a funded goal's account link moves its current saved balance
between backing locations. Archive requires withdrawing all goal money first.

Deposits need enough source money after other linked goal holdings. Withdrawals
and account-link changes cannot use money backing other goals. A linked account
can still develop a shortfall through ordinary spending; the existing attention
warnings show that shortfall.

## Existing vaults

On the first startup with this update, every active goal reservation is converted
to money held in that goal. Each original source account is debited once, and goal
progress is retained. Archived goals retain their historical allocations without
moving money. The additive migration and its column marker run in one transaction;
restarting does not repeat the conversion. Existing reservation shortfalls may
therefore become negative source-account balances. Keep a vault backup before
upgrading; restore that backup together with the previous app version to undo the
conversion. Do not run the previous version against a converted vault.

## REST and MCP

Create/update goal inputs accept optional nullable `linked_account_id`. Reads
include `linked_account_id` and `linked_account_name`.

`POST /api/finance/goals/{id}/movements` and `move_finance_goal_money` accept
`request_id`, current goal `version`, `direction` (`deposit` or `withdrawal`),
`account_id`, and a positive decimal PHP `amount`. MCP also takes `id`.
Money movements require both `finance:manage` and `finance:write`. Updating an
account link also requires both scopes. Metadata-only updates remain manage-only.
Request replay, effects, holdings and audit are committed atomically.

The existing allocations endpoint/tool retains its absolute per-source amount
contract. Increases now transfer the difference into the goal; decreases return
the difference to that account. It requires both scopes. Allocations identify
remaining contributions from funding accounts; they no longer reserve cash in
those source accounts. New clients should use the movement operation.

## Browser verification

Use clearly named `TEST GOAL` fixtures on an authorized local vault. Check an
unlinked deposit, a linked deposit, withdrawals to the source and another account,
link/unlink with saved money, insufficient funds, over-withdrawal and archive
protection. Account changes must match the goal amount exactly; total money and
income/expense totals must stay unchanged. Fixture balances and audit persist.
