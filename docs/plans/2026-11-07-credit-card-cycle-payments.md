# Credit card cycles and statement payments

Outcome: expenses automatically form monthly cycle totals and reminders; payments can be recorded inside the card statement with explicit partial cashback control.
Problem: the previous screen selected only the latest closed statement, repayment required the generic transfer form, and cashback was all-or-nothing.
Done when: October 30 belongs to October 16–November 15, due December 5; early repayment leaves rewards pending; selected partial rewards and cash settle atomically without duplicate credits.

Approved decisions:
- Show upcoming cycle estimates immediately and preserve older unpaid cycles.
- Cashback defaults off; select rewards and apply all or part. Already credited cashback remains included in balances.
- Default cash amount is remaining balance less selected rewards until manually edited; allow partial and early payments.
- Reject future card repayments and cashback applications, including correction bypasses. Existing future records remain unchanged; scheduled payments are deferred.
- Purchases remain individual activity records; each cycle has one combined statement total. Credits settle oldest outstanding principal first.
- Frontend: Sonnet 5.5 medium. Manual built-in browser verification: GPT-6 Luna xhigh. Apply Anti Slop during implementation.

## Slices

- [x] 1. Derive cycles and reminders — upcoming estimates, unpaid history, actual bank cutoff overrides and unique principal allocation. Check: isolated cutoff, carry-forward and confirmed minimum tests.
- [x] 2. Partial cashback — schema 8 preserves legacy credits and adds application history; corrections preserve actual credited amounts; undo reverses all applications. Check: isolated migration, correction, replay and rollback tests.
- [x] 3. Statement payment — selected cash account plus optional rewards in one atomic capability, REST and MCP; future dates rejected. Check: isolated payment and cross-transport scope/replay tests.
- [x] 4. Verify and review — full project checks, desktop/mobile finance journey, Luna manual built-in browser pass, fresh review, documentation. Check: evidence below; two unrelated scoreboard failures remain.

Verification: 221 finance/architecture tests passed; 14 finance Playwright tests passed at desktop/mobile widths, then both payment journeys passed again after the carried-balance default adjustment. Typecheck, lint, MCP stdio, and an isolated production build passed. Full `npm test`: 629 tests, 627 passed, two unrelated scoreboard stability failures (`no_vectors`), also reproduced in that file alone. An earlier auth limiter timing failure passed on rerun and in the final full suite.

An additional focused backend and browser regression passed for cashback already included at a confirmed cutoff: recording that credit does not discount the cash due twice. These checks followed the full-suite run.

Initial review found cumulative minimum allocation, competing actual cutoffs (including month-end), and same-second confirmation replacement defects. All were reproduced with failing integration tests and fixed. `readCreditCycles` remains one cohesive ledger projection; its length reflects chronological credit allocation and bank reconciliation rather than unrelated workflows.

Existing future-dated demonstration records described in the November 6 handoff have not been changed. The initial built-in browser pass found stale schema-7 local server code against schema 8; JC authorized restarting only localhost:3000 after checks finished. That restart is complete, and the local dev server remains running with the updated code.

## Manual built-in browser handoff

GPT-6 Luna at xhigh completed the desktop walkthrough in the existing logged-in built-in browser. Sonnet 5.5 at medium implemented the frontend. No real bank payment was executed; these are persistent simulated records in the existing local vault.

Created group **Demo - Cycle check Nov 2026**, with both accounts excluded from totals:

- **DEMO Cycle Check Savings - Nov 2026**: opening PHP 10,000.
- **DEMO Cycle Check Credit Card - Nov 2026**: limit PHP 30,000, cutoff 15, fixed due day 5, linked to that savings account.

| Purchase cycle | Purchase saved | Cutoff | Expected SOA | Estimated due |
| --- | --- | --- | --- | --- |
| September 16–October 15, 2026 | September 30: PHP 5,000, 2% cashback (PHP 100 earned) | October 15 | October 16 | November 5 |
| October 16–November 15, 2026 | October 30: PHP 2,000, cashback off | November 15 | November 16 | December 5 |

Before payment, the first cycle had PHP 5,000 unpaid. The upcoming statement total showed PHP 7,000 including carried debt; its separately attributed amount was PHP 2,000, so reminders did not count the carried PHP 5,000 twice.

| Recorded November 7, 2026 | Cash paid | Cashback applied | Older bill remaining | Cashback pending |
| --- | --- | --- | --- | --- |
| First payment, cashback off | PHP 1,000 | PHP 0 | PHP 4,000 | PHP 100 |
| Second payment, partial reward selected | PHP 3,960 | PHP 40 | PHP 0 | PHP 60 |

Final observed balances: Savings **PHP 5,040**; card debt **PHP 2,000**, available credit **PHP 28,000**; cashback **PHP 40 applied / PHP 60 pending**. The old November 5 bill stopped appearing as unpaid. The upcoming PHP 2,000 is due December 5. November 8 was disabled in the payment date picker. No payment/cashback errors occurred. The browser was left on card details with the upcoming cycle selected. Manual mobile checks were skipped because both widths were covered by Playwright.

These new fixtures remain in the local vault. Excluding accounts from totals does not remove their activity from reports. Earlier demo records and existing real accounts were not manually modified. No commits or deployment were made.

## Payment modal follow-up

At JC's request, only payment logging moved out of the account drawer into a **Record credit card payment** modal opened by **Record payment**. Cycle selection and bank statement confirmation remain in the drawer. Closing or cancelling makes no payment; validation errors keep the modal and inputs open; successful recording closes it and refreshes the statement. Dismissal is blocked while saving.

Verification: the three affected Playwright journeys passed against a disposable local vault, covering phone/desktop, Escape focus return, cancellation, validation, partial cashback and cashback already included in a confirmed statement. Typecheck, targeted ESLint and the final diff check passed. No manual browser walkthrough or full Node suite was repeated for this UI-only follow-up, and no live financial records were changed.

## Current flow (supersedes the drawer confirmation form)

Per JC, the **Confirm statement** form was removed from the card drawer. Logged purchases assign cycles and due dates automatically; the drawer shows the cycle list and **Record payment**. `confirmStatement`, REST/MCP, schema and existing bank-confirmed data are unchanged as an optional reconciliation fallback, and confirmed metadata still displays read-only.

Verification: four affected Playwright journeys passed in a disposable vault (automatic cycles and modal payments on phone/desktop, existing confirmed minimum alerts, and already-included cashback). Typecheck, targeted lint and diff checks passed. The unused confirmation-form hook was removed. No live financial records changed; the full Node suite was not repeated for this UI removal.
