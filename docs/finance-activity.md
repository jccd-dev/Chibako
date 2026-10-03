# Finance activity preview

The finance page records actual PHP income, expenses and transfers, shows month
totals, and supports filtered activity inspection, balance reconciliation and
asset valuation. Corrections/refunds, planning and import remain later slices. This is not the full finance release.

## Owner workflow

Use **Add transaction** on any finance tab. Expense is the default; switch to
Income or Transfer when needed. Transfers require different active money
accounts. An optional positive fee requires an expense category and posts as a
separate linked expense from the source account, atomically with the transfer. Supply a positive PHP amount, an active money account and
the calendar day money moved. Categories are optional, with Uncategorized as the
fallback. Transaction text and up to 20 managed tags live under Additional details.

**Save and add another** retains type, account, date and category while clearing
the amount and optional text/tags. Transfers also retain destination and fee
category, but clear the fee amount. Saving retains the current tab and Activity
filters. Forms are desktop side panels and mobile full-screen sheets.

Manage creates, renames, archives and restores income/expense categories,
one-level subcategories and tags. Archiving preserves classifications on existing
activity but prevents using them for new entries. Category type and parent are
immutable; create a different classification rather than recategorizing history.

Overview shows income and spending for the selected calendar month, defaulting
to this month. Openings, transfers, reconciliation and valuations are excluded
from income/spending; transfer fees count as spending. Account balances are
openings plus signed posted effects. Negative balances warn but do not
block actual posting; values outside the exact supported cent range are rejected.
Assets remain separate from cash and cannot receive income/expense postings.

Activity supports text/category/tag search, inclusive date ranges, account,
category/subcategory and transaction-type filters. Select a record to inspect
its text, tags and recording time separately from its transaction date.

In Manage, **Reconcile** compares a money account's latest derived balance to
an actual signed PHP balance. **Adjust value** does the same for assets, without
cash movement. Preview the difference and choose a calendar date before
recording it. Neither action overwrites the opening or history. A changed balance
rejects the comparison; refresh and review again. The dated difference, compared
balance and supplied actual value remain inspectable in Activity.

## REST and MCP

All adapters call the Next-free finance capability. Mutations require a
`request_id`; identical retries return the original result and original balance,
even after subsequent activity. Changed-payload reuse fails with
`request_conflict`. Classification updates require the current `version` and
reject stale edits. Writes and audit/retry outcomes commit together.

| Scope | REST | MCP |
| --- | --- | --- |
| `finance:write` | `POST /api/finance/activity` | `post_finance_transaction` |
| `finance:write` | `POST /api/finance/activity/transfers` | `post_finance_transfer` |
| `finance:write` | `POST /api/finance/activity/reconciliations` | `reconcile_finance_account` |
| `finance:write` | `POST /api/finance/activity/valuations` | `value_finance_asset` |
| `finance:read` | `GET /api/finance/activity` | `list_finance_activity` |
| `finance:read` | `GET /api/finance/activity/:id` | `get_finance_transaction` |
| `finance:read` | `GET /api/finance/activity/totals` | `get_finance_activity_totals` |
| `finance:read` | `GET /api/finance/classifications` | `list_finance_classifications` |
| `finance:manage` | `POST /api/finance/classifications` | `create_finance_classification` |
| `finance:manage` | `PATCH /api/finance/classifications/:id` | `update_finance_classification` |

Write and manage do not grant read. Legacy wildcard keys gain no finance scope.
Owner browser sessions and trusted keyless local stdio retain authorized access;
remote MCP uses request-scoped keyed authorization, never local trust.

Posting accepts `type` (`expense` by default, or `income`), `account_id`,
`amount` (decimal string), `transaction_date` (`YYYY-MM-DD`), optional
`category_id`, `subcategory_id`, `text` and `tag_ids`. Subcategories must belong
to the selected category and transaction type. Currency is PHP only.

Transfers accept `source_account_id`, `destination_account_id`, positive `amount`,
`transaction_date`, optional `text`/`tag_ids` and an optional `fee` object
(`amount`, required expense `category_id`, optional `subcategory_id`). Fees share
the transfer date and debit the source, but appear as their own categorized
expense linked to the transfer. Transfers cannot target assets or archived accounts.

Reconciliation and valuation accept `account_id`, signed decimal `actual_balance`,
`expected_balance_cents` (the latest derived balance), `transaction_date`, optional
`text`/`tag_ids`. Reconciliation targets active money accounts; valuation targets
active assets. If the compared balance changed, they return `balance_conflict`
(409), not an unintended correction. Zero differences remain explicit records.
All three mutations require `request_id`; optional `currency` accepts only PHP.
They return `transaction`, optional `fee`, both affected account `balances` (one
for adjustments), and warnings. All linked rows, audit and retries are atomic.

History accepts `q`, `date_from`, `date_to`, `account_id`, `category_id`, `type`,
`limit` (1-100, default 50) and `offset`. Reads omit transaction text, tag IDs and
recording timestamps by default. Request `include_details=true` in REST or
`include_details: true` in MCP to include these details. Reading one record has
the same explicit-detail contract. Activity type includes `expense`, `income`,
`transfer`, `reconciliation` and `valuation`; account filters match either side
of a transfer. Compact linked IDs permit inspection from transfer to fee and
back. Monthly totals accept `month` (`YYYY-MM`).
Classification listing supports kind, income/expense type and archived filters,
with the same pagination limits.

Posting returns a compact transaction, resulting `balance_cents`, and warnings
such as `negative_balance`. Audit records actor identity, operation, timestamp
and affected transaction/account IDs; raw API keys are never recorded.

## Verification safety

Finance tests use synthetic disposable SQLite Vaults. Browser checks must use
an explicit fresh temporary `CHIBAKO_E2E_DATA_DIR` and an isolated
`CHIBAKO_BUILD_DIR`. Do not use production, the daily-driver Vault, or its build
channel. No live import or deployment is authorized by this preview.
