# Planned and recurring activity

Ticket 07 adds one-time income and expense expectations to Planning. Plans do
not move cash or consume actual budgets. Due and overdue plans remain pending
until the owner posts actual activity, explicitly matches an existing transaction,
or cancels the expectation. Ticket 08 adds recurring schedules and explicit
catch-up. There is no automatic posting.

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

## Recurrence

Schedules repeat every N days, weeks, months or years, anchored to a start
date with an optional inclusive end date. Month and year intervals clamp to
the final valid day while retaining the original anchor: January 31 repeats
on February 28 and then March 31. A February 29 yearly schedule returns to
February 29 in a leap year.

Opening Planning prepares missed dates plus the next upcoming occurrence
through an audited catch-up write. **Refresh due occurrences** repeats this
preparation; API reads never create entries. Large backlogs are processed in
bounded batches using **Load more missed occurrences**.
Every occurrence stays pending until individually posted, matched or skipped.
Selected pending occurrences can also be skipped atomically as a batch.
Skipping changes no balance or actual spending.

Edit **This occurrence only** to change one pending expectation. Choose
**This and future occurrences** to change the schedule from a selected pending
occurrence. Satisfied history and its transaction links remain intact.
Pause stops generation and retains existing pending review. Resume requires
explicit review and defaults to the next future scheduled date, leaving paused
dates ungenerated. Imported definitions can remain paused until owner review.
The owner UI passes its local date as `resume_after` and uses that same date
for Planning catch-up. REST and MCP callers may supply `resume_after` and
`through_date` too; when omitted, the capability uses the current UTC calendar
date.

Recurring occurrences use the same posting and matching contract as one-time
plans. Delete retains satisfaction; Revert reopens the linked occurrence.

Schedule reads require `finance:read`, schedule management requires
`finance:manage`, and catch-up, occurrence edits and skipping require
`finance:write`. These permissions do not imply one another. Every mutation
requires a request ID; record changes also require the current version.

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
| `POST /api/finance/plans/catch-up` | `catch_up_finance_plans` |
| `POST /api/finance/plans/skip` | `skip_finance_plans` |
| `GET /api/finance/schedules` | `list_finance_schedules` |
| `GET /api/finance/schedules/:id` | `get_finance_schedule` |
| `POST /api/finance/schedules` | `create_finance_schedule` |
| `PATCH /api/finance/schedules/:id` | `update_finance_schedule` |
| `POST /api/finance/schedules/:id/pause` | `pause_finance_schedule` |
| `POST /api/finance/schedules/:id/resume` | `resume_finance_schedule` |

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

Schedule creation uses the plan template fields with `start_date` in place of
`due_date`, plus `interval_count`, `interval_unit` (`day`, `week`, `month`,
`year`), optional `end_date`, and optional `paused`. Schedule updates require
`version`; `from_plan_id` and `from_plan_version` select the pending occurrence
and reject stale selection for a future edit.
Catch-up accepts `request_id` and optional `through_date`, returning
`created_count` and `has_more`. Repeat with a new request ID while `has_more`
is true. Bulk skip accepts `request_id` and up to 100 `{id, version}` entries.
If any selected entry is stale or no longer pending, the whole batch fails.
Reducing an end date cancels pending dates beyond the boundary; extending it
reopens those dates. Explicitly skipped dates stay skipped. Catch-up reuses an
occurrence reopened by Revert, even after a cadence edit, so one schedule date
cannot produce two active plans.

## Verification

Real-SQLite tests use temporary vaults. `tests/finance-planning.test.ts` covers
zero pending effects, partial updates, lifecycle, idempotency, version checks,
eligibility, rollback, audit and forecast separation.
`tests/finance-planning-protocol.test.ts` checks REST/remote MCP scopes and parity.
`tests/finance-recurrence.test.ts` covers anchored intervals, bounded catch-up,
pause/resume, owner-date catch-up after resume, future edits, satisfied-date
collisions, cross-generation Revert, end-date extension with preserved skips,
skip atomicity and post/match idempotency.
`tests/finance-recurrence-protocol.test.ts` checks
schedule permissions and REST/remote MCP parity.

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

Live ticket 08 browser verification ran on the same local dev Vault with
`TEST 08 T3 recurrence` and `TEST 08` schedule fixtures. Confirmed month-end
catch-up exposed July 31, August 31, September 30 and the next upcoming date
without posting; an amount-only future edit preserved the selected calendar
anchor; cadence changed to every two months from the selected July 31
occurrence and refreshed to September 30/November 30; pause kept pending
review, and resume advanced from the owner's October 4 local date to the next
future occurrence. The schedule form fit a 390x844 viewport without horizontal
overflow; desktop was checked at 1440x900. These named fixtures persist in the
dev Vault. No actual transaction or balance changed.

A second owner-flow check created the paused `TEST 08 E2E recurrence owner
verification` schedule for PHP 1 monthly from October 5, 2026 through April 5,
2027, using the synthetic `TEST 08 T3 recurrence` account. Its October 5
pending occurrence remained available through pause and resume; resume kept
October 5 as the next owner-local future date. The UI confirmed balances stayed
unchanged, and no transaction was posted. At 390x844, document width remained
390px with no horizontal overflow. This named schedule and pending occurrence
persist in the local dev Vault, paused.
