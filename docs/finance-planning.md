# One-time planned activity

Ticket 07 adds one-time income and expense expectations to Planning. Plans do
not move cash or consume actual budgets. Due and overdue plans remain pending
until the owner posts actual activity, explicitly matches an existing transaction,
or cancels the expectation. There is no scheduler or automatic posting.

## Lifecycle

A plan has a type, expected money account and PHP amount, due date, optional
category/subcategory, text and tags. `pending` plans can be edited or rescheduled.
`satisfied` plans link to exactly one actual transaction. `cancelled` plans have
no cash effect and leave pending review and forecasts.

Posting confirms an actual account, amount and transaction date. These can
all differ from the expectation. One atomic mutation creates the transaction,
updates the balance and satisfies the plan. The expected fields stay intact.

Matching selects an existing unreverted income/expense of the same type. The
actual amount, account and date may differ. Transfer fees and already-linked
transactions cannot match. Matching changes no cash or actual spending; it bumps
the transaction version so stale Activity actions cannot overwrite the new link.
It never chooses a match automatically.

Delete hides linked actual activity but retains its balance/spending effect and
plan satisfaction. Revert reverses mistaken actual activity and reopens the
linked plan atomically. Cancel is only for pending plans. Returned versions and
request IDs follow the shared finance mutation contract.

## Forecasts

Reports show pending planned income and planned spending separately for the
selected due-date range. Actual spending, refunds and budget progress still use
actual transaction dates. Posting or matching removes a plan from forecasts;
Revert restores it and cancellation removes it. The Overview uses the same
report range. Forecasts do not alter account balances, income or spending totals.

## REST and MCP

Reads require `finance:read`; mutations require `finance:write`. `finance:manage`
alone cannot access these operations. Legacy Notes scopes grant no finance
access. Owner sessions and trusted local MCP use the existing finance policy.

| REST | MCP |
| --- | --- |
| `GET /api/finance/plans` | `list_finance_plans` |
| `GET /api/finance/plans/:id` | `get_finance_plan` |
| `POST /api/finance/plans` | `create_finance_plan` |
| `PATCH /api/finance/plans/:id` | `update_finance_plan` |
| `DELETE /api/finance/plans/:id` | `cancel_finance_plan` |
| `POST /api/finance/plans/:id/post` | `post_finance_plan` |
| `POST /api/finance/plans/:id/match` | `match_finance_plan` |

Lists support status (`pending` by default, `satisfied`, `cancelled`, `all`),
type, account, due-date range and pagination (50 by default, 100 maximum).
The owner UI pages 25 plans at a time. Due-date order is ascending with an ID tie-breaker. Compact reads omit
text, tags and timestamps; request `include_details=true` for inspection.

Create accepts `request_id`, `type` (expense by default), `account_id`, decimal
`amount`, `due_date`, and optional `category_id`, `subcategory_id`, `text` and
`tag_ids`. Updates require `version` and at least one editable field; omitted
fields remain unchanged. Cancel requires `request_id` and `version`.

Post accepts `request_id`, plan `version`, `account_id`, decimal `amount` and
`transaction_date`. Match accepts `request_id`, plan `version`, `transaction_id`
and `transaction_version`. Reusing a request ID with a different payload returns
409. Reusing it unchanged returns the saved result without another effect.

Activity's `matchable=true` query supplies eligible transactions for explicit
selection. The posting and matching capabilities enforce eligibility again at
commit, including stale-version checks. Plan mutations and linked Revert record
actor attribution and before/after relationship snapshots in the finance audit.

## Verification

Real-SQLite tests use temporary vaults. `tests/finance-planning.test.ts` covers
zero pending effects, partial updates, lifecycle, idempotency, version checks,
eligibility, rollback, audit and forecast separation.
`tests/finance-planning-protocol.test.ts` checks REST/remote MCP scopes and parity.

`tests/e2e/finance.spec.ts` covers the owner flow in a disposable vault on both
desktop and mobile: create leaves balances unchanged, posting moves the balance
once, a duplicate post is rejected, Delete hides while preserving satisfaction,
and Revert restores the balance and reopens the occurrence.

Live browser verification ran in the T3 Code browser against the dev server and
its dev Vault using named `TEST 07 T3` synthetic fixtures. Confirmed there:
planning left balances and actual spending unchanged; posting moved the balance
9300 → 5750 exactly once; a duplicate post returned 409 and held the balance;
matching applied no cash movement; a second plan could not reuse the same
transaction; Delete preserved satisfaction while Revert reopened the plan;
cancellation left balances untouched; and forecast rose to 999 while actual
spending (57305), category spending (4250) and the 5000 budget limit held
steady. Layout was checked at 1440x900 and 390x844. These fixtures persist;
personal activity remains untouched. The ticket 04 dependency pass is still
open.
