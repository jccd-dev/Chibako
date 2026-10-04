# Finance Note links

Activity records can carry up to 20 manually chosen Note links. This covers income, expenses, transfer fees, transfers, reconciliation, valuation and refunds. No account, goal or obligation linking is introduced by this ticket. Notes are never created, rewritten, dated or automatically matched by this flow. Transaction text stays on the finance record.

## Owner workflow

In Add transaction, expand **Additional details**, find a Note by title, inspect its read-only content, then select it. Save transaction and Save and add another attach the selection atomically with the posted activity. Save and add another clears the selection for the next entry.

In Activity, inspect a record and expand **Additional details: Note links**. Find/select Notes or remove selected links, then choose **Save Note links**. Selection alone does not save. Closing an unsaved panel discards its selection. The Activity tab and filters stay in place. Link edits can also annotate hidden or reverted activity without changing financial effects.

The picker shows at most 25 titles per page, searches titles literally, and excludes Trash. Note inspection requests content separately through the existing Notes API. Renamed Notes display their current title. Trashed Notes are not displayed or available for new attachment; permanent deletion removes their stored relationship. Existing Notes remain separate from finance history.

## REST and MCP

| REST | MCP | Required key scopes |
| --- | --- | --- |
| `GET /api/finance/notes?q=&limit=25&offset=0` | `list_finance_note_choices` | `finance:read` + `notes:read` |
| `GET /api/finance/activity/:id/notes` | `get_finance_note_links` | `finance:read` + `notes:read` |
| `PUT /api/finance/activity/:id/notes` | `set_finance_note_links` | `finance:write` + `notes:read` |

The PUT/tool payload is `{ request_id, version, note_ids }` (plus `id` for MCP). It replaces the complete selection; `note_ids: []` removes all links. Duplicate IDs, more than 20 IDs, and nonexistent/trashed targets are rejected. Request replay returns the original result; changed payload reuse and stale versions return conflicts. A successful edit increments the Activity version and returns the compact transaction, selected IDs and unchanged account balances. Audit stores actor, time, operation, affected IDs and before/after link IDs, not Note text or API key secrets.

Income/expense, transfer and adjustment posting also accept optional `note_ids`; nonempty selections require `notes:read` in addition to `finance:write`. Empty/omitted selections preserve older posting retry fingerprints. Ordinary finance reads, including `include_details`, contain no linked Note titles or content. Link reads return IDs/titles only, never content. Note content uses existing `read_note`/`GET /api/notes/:id`; editing still requires `notes:write` independently. `finance:manage` does not substitute for `finance:write` on Activity. Existing Note wildcard semantics remain intact, but finance permissions always require explicit finance scopes.

Keyless local stdio remains trusted. Configured invalid or empty keys never fall back to trusted access. Remote MCP retains stateless per-request authentication.

## Browser owner-flow check

Run in the T3 Code browser against your existing dev server. **Synthetic test activity and Notes persist in your vault.** Use clearly named fixtures, such as an existing synthetic account and a new Note named `Ticket 05 synthetic Note`, rather than personal finance activity.

On desktop and phone-sized viewports, in light and dark themes:

1. Record the synthetic Note's content and date. In Finance > Activity, retain a filter matching your synthetic account.
2. Add a small synthetic Expense with distinct transaction text. Expand Additional details, find the Note by title, inspect it, close Note inspection, and select it. Save transaction. Confirm the tab/filter remain and the expense posts exactly once.
3. Inspect that transaction. Expand Note links, inspect the linked Note, remove it, save links, and verify the account balance did not change. Reopen to confirm removal persisted.
4. Attach the same Note again and save. Confirm the Note's content/date are unchanged, and the transaction text still belongs to finance.
5. Use Save and add another with a Note selected. Confirm the next entry starts with no selected Note links. Cancel the next entry.
6. Check keyboard Find/Inspect/Select/Remove/Save and Escape to close the sheet. Long titles/content must wrap; mobile stays full-screen without horizontal overflow.
7. Check no-match search, loading feedback, failure/retry (e.g. offline read), and refresh-details recovery for a stale Activity version. Confirm no browser console errors.

Automated checks use disposable real SQLite and cover capability invariants, keyed REST/remote MCP scope combinations, and trusted-local/keyed stdio. `tests/e2e/finance-note-links.spec.ts` drives this owner workflow (desktop and phone-sized views) against a disposable vault (`npx playwright test --config playwright.finance.config.ts`), covering select/inspect/attach/remove, Save and add another, failure/retry, and stale-version recovery. It does not replace the live dev-instance browser run in the T3 Code browser.
