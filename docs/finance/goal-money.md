# Goal money

A linked goal tracks one active money account: its progress is that account's
live positive balance. Transfers, income, spending, refunds and reverts on the
account all change progress. An account backs at most one active goal, so a
balance is never counted twice. Linked goals hold no money of their own.

Without a link, the goal holds its own money. Adding money deducts it from the
selected source account and keeps it in the goal; it is included once in total
money, outside account balances. For a linked goal, adding money moves it from
the source into the linked account. Goal movements do not create income or
expenses and do not affect cash-flow reports.

Withdrawals send money to a selected active money account other than the linked
account. A linked goal's withdrawal debits its linked account; an unlinked goal's
debits its held money. Linking an unlinked goal moves its held money into the
account. Switching to another account or clearing the link moves no money; a goal
that loses its link starts with no held money. Archiving an unlinked goal requires
withdrawing its money first; a linked goal can be archived with money left in its
account.

## Existing vaults

Schema 6 deletes funding-allocation rows of linked goals, because a linked goal's
progress now comes from its account balance. Balances and goal movements are not
changed. Restoring a pre-upgrade backup with the previous app version undoes it.

The earlier goal-money update did the following:

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
