# Ticket 06 verification

Verified on 2026-10-04, branch `dev`, baseline `06433acf`.

## Automated checks

- `npm run typecheck`: passed, including after controller cleanup.
- `tests/finance-budgets-reports.test.ts`: 2 passed (effective limits, specific-month corrections, version/retry rollback, category aggregation, cross-month refunds, hidden/reverted semantics, exact PHP values and exclusions).
- `tests/finance-budgets-protocol.test.ts`: 1 passed after correcting the test's empty-scope catalog handling.
- `tests/finance-protocol.test.ts`: 3 passed after updating expected scope catalogs for the new tools.
- `tests/architecture-boundaries.test.ts`: 4 passed.
- `npm run test:mcp-stdio`: passed both smoke checks and standalone MCP bundle.
- Full `npm test` ran once: initially 132/135 passed. Two finance failures were corrected and rerun successfully in the focused checks above. The remaining `password-routes.test.ts` startup failure is dev-server lock contention; the harness attempts another Next dev process in this checkout. The full suite is **not reported as green**. No auth or test-server configuration changed for this ticket.

Scout mapped the capability seams. Tester ran automated commands. Independent Standards and Spec reviewers returned no P0/P1 findings. Standards' meaningful controller-policy finding, duplicate month validation, and duplicated response helper were corrected and re-reviewed. Nonblocking selector/conversion duplication and naming observations remain deferred. No budget removal flow was added because the ticket does not request one.

## Browser checks

Parent ran these checks directly in the signed-in T3 browser, not through `e2e_tester`. Exact target: `http://localhost:3000/app/finance`, existing Next dev checkout with `./data/brain.db`. Confirmed server cwd/database handles before mutations. After that dev process stopped, restarted the same `npm run dev` target, without creating another vault/build channel.

Synthetic fixture: account, expense category, and subcategory named `Ticket06 E2E 2026-10-04` / `Ticket06 E2E 2026-10-04 child`. Opening PHP 100.00, income PHP 30.00, expense PHP 20.55 on 2026-10-04. Only synthetic rows were mutated. These fixtures persist in the dev vault; no personal records were changed or captured in this report.

- **Desktop (1280 × 800):** Planning → Set budget opens side panel. Select synthetic category, October, forward PHP 10.00 → Save budget closes panel and confirms save. Overview reports synthetic spending PHP 20.55 against PHP 10.00, with over-budget warning. Planned forecast remains explicitly unavailable and separate.
- **Desktop drilldown:** Select synthetic category → Activity with category ID, October dates, all accounts, visible plus hidden records, and active effects only. The synthetic subcategory expense appears; unrelated income does not.
- **Mobile (390 × 844):** Set budget opens a 390px full-screen sheet. Change to correction mode and PHP 25.00, submit with Enter → sheet closes and confirms save. Reopen: October limit PHP 25.00. Change month to November: limit remains PHP 10.00, proving the correction did not change future months. Escape closes sheet.
- **Mobile report/drilldown:** November dates → Update report shows zero actuals and synthetic limit PHP 10.00. Category selection → empty November Activity with matching dates/category. Returning to Overview retains report dates.
- **Error/recovery:** Range exceeding 12 months → clear range-validation alert. Retry reports preserves the same explanatory error. Correct range → successful report. January 2020 → explicit empty report message.
- **Themes/layout:** Light desktop and dark 320px mobile report controls stay 44px high. No horizontal overflow at 1280, 390 or 320px. Computed muted-text/body-background contrast was 7.08:1 in light and 8.79:1 in dark. Existing keyboard focus styles retained; keyboard Enter and Escape exercised.
- **Diagnostics:** Inspected browser console showed HMR logs but no application exceptions during the successful flows. Server interruption/tool failures were not counted as passing interactions; the affected check was repeated successfully after restart.

## Antislop gate (ticket surface only)

- Hard Gate PASS: functional budget/report controls, explicit empty/error/forecast states, 44px targets, no overflow, both themes checked, no invented claims/assets.
- Purpose Gate PASS: incumbent semantic tokens/fonts, green primary actions, flat dividing rules, and responsive sheet distinguish actions and protect form focus. No new decorative effects or icons.
- Liveliness PASS: ENERGY 1 / RHYTHM 2 / MOTION 1; actual spending leads, limits defer, monthly rows carry trends, whitespace separates reporting from account review.
- Craftsmanship PASS: dates and cents drive content; report drills into real Activity; forecast is not guessed; existing four-tab identity and outside-scope UI are preserved.

Pagination and low-level refund/revert/exclusion branches are verified at the real SQLite/protocol seams rather than creating dozens of persistent browser fixtures. No broader release-readiness claim is made.
