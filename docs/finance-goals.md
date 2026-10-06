# Savings goals and account reservations

Planning creates PHP savings targets and reserves money already held in money
accounts. One goal can use several accounts. Reservations across every active
goal must fit an account's current cash when increased. They never post
transactions, change account balances, or count again in cash totals or reports.

Set an allocation to its new total, rather than an increment. Set `amount` to
`"0"` to release it. Reductions and releases work during a shortfall and on
archived accounts; increases require an active money account. A goal supports
at most 100 allocated accounts, and its combined progress must fit the supported
exact-cent range. `saved_cents` is derived from allocations, not editable.

Spending remains allowed when cash falls below reservations. Cash mutation
results include `warnings: ["allocation_shortfall"]` and account-level
`allocation_shortfalls` with reserved cash, current balance and uncovered
reservation amounts. Negative balances also produce `negative_balance`.
An account with negative cash has all its reservations uncovered; its cash
deficit remains separate. These warnings also cover transfers, reconciliation,
corrections, refunds/reverts and plan posting. Goal rows and details show the
same account-level shortfall; do not add repeated shortfalls across goals on
the same account.

Reaching the target sets `achieved`. Releasing reservations or raising the
target can remove achievement. Archiving retains target, progress and allocation
history, excludes those allocations from active reservations, and makes the
goal read-only. Cash stays unchanged. The archived view provides history.

## REST and MCP

| REST | MCP tool | Required scope |
| --- | --- | --- |
| `GET /api/finance/goals` | `list_finance_goals` | `finance:read` |
| `GET /api/finance/goals/:id` | `get_finance_goal` | `finance:read` |
| `GET /api/finance/goals/accounts` | `list_finance_goal_accounts` | `finance:read` |
| `POST /api/finance/goals` | `create_finance_goal` | `finance:manage` |
| `PATCH /api/finance/goals/:id` | `update_finance_goal` | `finance:manage` |
| `PUT /api/finance/goals/:id/allocations` | `set_finance_goal_allocation` | `finance:manage` |

Lists accept `limit` (1–100), `offset`, and `archived` (`false`, `true`, or `all`),
defaulting to active rows. Money-account summaries include cash, reserved,
available and shortfall cents. Goal progress is separate from cash summaries.

Create takes `request_id`, `name`, decimal-string `target`, and optional
`due_date`. Edit takes `request_id`, `version`, and changed fields (`name`,
`target`, nullable `due_date`, `archived`). Allocation takes `request_id`, goal
`version`, `account_id`, and nonnegative decimal-string `amount`. MCP edit and
allocation tools also take goal `id`.

All mutations reuse the shared atomic request-ID, version and audit contract.
Identical retries return the original outcome, even after later edits. Changed
payload reuse and stale edits return conflicts. Audit retains actor, time,
operation, affected goal/accounts and before/after progress. Manage/write
scopes never imply read. Both MCP transports use the same capability.

## Verification

`tests/finance-goals.test.ts` uses a disposable temporary SQLite vault. It checks
cash/report isolation, cross-account limits, retry/version behavior, release,
shortfalls on cash-write paths, achievement/archive history, exact-cent limits,
independent REST/MCP scopes and adapter parity.

The complete suite passed 158 tests, typechecking passed, and the standalone
MCP smoke checks passed. The owner flow used `http://127.0.0.1:3000` on the
normal dev server with `DATA_DIR=./data`: T3's browser first, then Playwright
after the preview host became unavailable. Desktop (1440×900) and mobile
(390×844) checks covered light/dark rendering, keyboard focus, allocation
limits, achievement, release, a posted expense with a shortfall, archive
history and cancellation. The final warning text passed a focused contrast
check in both themes without further data writes.

Synthetic `TEST 09` fixtures persist in the local vault. Account A holds
PHP 70.00 after a PHP 30.00 expense, with PHP 40.00 reserved for the competing
goal; account B holds PHP 50.00 without active reservations. The archived
cross-account goal retains PHP 70.00 of historical allocations. Exact fixture
names, IDs and evidence are recorded in the implementation ticket.
