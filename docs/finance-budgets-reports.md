# Monthly budgets and reports

Planning manages top-level expense-category budgets in PHP. Limits include subcategories across all accounts, start on calendar day 1, and do not roll over.

- **From this month onward** replaces every limit and correction from the selected month forward, preserving earlier months.
- **Correct this month only** overrides that one month without changing other limits.
- Each category schedule has one version. Use version `0` for an absent schedule; fetch the current version before editing. Stale edits return `version_conflict`.
- Zero is a valid limit, not an absent budget. A positive expense against zero warns in reports. Posting is never blocked by a budget.

Overview reports default to the current calendar month. Select an ordered date range spanning at most 12 calendar months. Category rows paginate (50 default, 100 maximum). Income/spending totals and monthly trends cover the whole range independently of pagination. Partial-month actuals compare to **whole-month limits**, not prorated limits. A range reports overspending when any included month exceeds its limit, without netting one month's overrun against another month's surplus.

Actual spending is posted expenses minus refunds on their refund dates. Hidden records count; reverted mistakes do not. Openings, transfers, reconciliations and asset valuations are excluded. A transfer fee is an expense. Existing category names, including imported `other`, are retained unchanged. Unbudgeted spending includes uncategorized activity and activity in category-months without a limit.

Select a category to open Activity with that category, report dates, all accounts, visible and hidden activity, and active effects only. Report dates and filters remain in the mounted four-tab page. Planned forecasts have a distinct section with pending one-time income and spending due in the selected range. The response retains the `available` compatibility field, now `true`, and returns exact `income_cents` and `spending_cents`. Forecasts never consume actual budgets. See [one-time planned activity](finance-planning.md).

## REST

- `GET /api/finance/reports?date_from=2026-10-01&date_to=2026-10-31&limit=50&offset=0`, `finance:read`.
- `GET /api/finance/budgets?category_id=<id>&month=2026-10`, `finance:read`.
- `PUT /api/finance/budgets`, `finance:manage`:

```json
{
  "request_id": "unique-client-request",
  "category_id": "expense-category-id",
  "month": "2026-10",
  "mode": "forward",
  "amount": "1000.00",
  "version": 0
}
```

Use mode `correction` for a single month. A mutation returns `{ budget }` with `category_id`, `month`, `version`, `limit_cents`, and `currency`. Identical request retries replay the original result. Reusing the same request ID with changed payload returns `request_conflict`. Changes, retry outcome and before/after schedule audit commit together.

## MCP

`get_finance_report`, `get_finance_budget`, and `set_finance_budget` share the REST capability validation and results. Read and manage are independent scopes; neither manage nor write grants read. Existing keys gain no finance permissions. No personal transaction text is returned by reports.

## Verification

Automated capability/protocol checks use disposable SQLite databases:

```sh
node --import tsx --test tests/finance-budgets-reports.test.ts tests/finance-budgets-protocol.test.ts
npm run typecheck
npm test
npm run test:mcp-stdio
```

Browser checks must use the existing `npm run dev` server and `./data` dev vault, not the isolated finance Playwright build configuration. Synthetic browser fixtures persist. Ticket 06 records browser evidence separately from automated checks.
