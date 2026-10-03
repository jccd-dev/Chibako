# Finance accounts preview

The Finance page is available from the workspace sidebar or mobile workspace menu. Ticket 01 implements PHP money and asset accounts. Activity, planning, and import remain previews until their tickets are complete.

Money and asset totals are separate. Openings establish balances without income or spending. Account type, currency, and opening are immutable after creation. Renaming and archiving preserve balances; archived holdings remain in totals and can be restored.

## REST and MCP

All endpoints require an owner session or an explicitly scoped bearer key. Existing keys gain no finance permissions, including legacy wildcard keys. The three finance scopes are independent: `finance:read` reads balances and accounts, `finance:manage` manages accounts, and `finance:write` is reserved for activity in subsequent tickets. Manage and write do not imply read.

| REST | MCP tool | Required scope |
| --- | --- | --- |
| `GET /api/finance/accounts` | `list_finance_accounts` | `finance:read` |
| `GET /api/finance/accounts/:id` | `get_finance_account` | `finance:read` |
| `GET /api/finance/summary` | `get_finance_summary` | `finance:read` |
| `POST /api/finance/accounts` | `create_finance_account` | `finance:manage` |
| `PATCH /api/finance/accounts/:id` | `update_finance_account` | `finance:manage` |

List inputs: `limit` (1-100, default 50), `offset` (default 0), `archived` (`false`, `true`, or `all`; default `false`), and optional `kind` (`money` or `asset`). REST passes these as query parameters; MCP passes them as tool arguments.

Create body:

```json
{"request_id":"account-create-1","name":"Cash","kind":"money","currency":"PHP","opening_balance":"123.45"}
```

Create and update return `{ "account": ... }`, including `id`, `version`, `opening_balance_cents`, and `balance_cents`. Reads return integer cents, with an exact range of ±9,007,199,254,740,991 cents per account or total. Unsupported currency, excess precision, and out-of-range amounts are rejected. Negative openings are allowed and warned in the UI.

Update body:

```json
{"request_id":"account-edit-1","version":1,"name":"Wallet","archived":false}
```

MCP update also takes `id`. Reuse the same request ID and payload when retrying an uncertain mutation. Identical retries return the original result, even after subsequent edits. Reusing a request ID with different content returns `request_conflict`; stale versions return `version_conflict`. Request IDs are namespaced by actor. Account writes, audit records, and retry results commit together.

Unconfigured local stdio MCP is trusted and attributed as `trusted-local-mcp`. Any configured key, including an empty or invalid value, must authenticate and never falls back to trust. Remote MCP authenticates every request independently. Audit records store actor identity, timestamps, affected IDs, and before/after values without bearer credentials.

## Local verification

The finance tests use disposable SQLite vaults. The browser configuration uses port 3221 and a separate build directory.

```sh
npm test
npm run test:mcp-stdio
npx playwright test -c playwright.finance.config.ts
```
