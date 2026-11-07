# Credit card flow aligned with PH banks

Outcome: Chibako's credit card numbers (debt, statement amount, due date, money held to pay it) match what a Philippine issuer shows, so JC can spend on a card and repay from a money account without overspending.

Problem: cashback lowers card debt on the purchase date (`src/features/finance/activity.ts:88-94`), but MariBank PH holds it in a Rewards Wallet until statement day and BPI-style cards hold it until redemption. Card spending is only checked against available credit (`account-policy.ts:6`); no money account is set aside to repay it. Due alerts use only an estimated remaining statement balance (`accounts.ts` `creditStatement`, `overview.ts:155`), with no minimum amount due and no way to use the bank's own statement figures.

Done when: on a MariBank test card, a ₱5,000 purchase with 1% cashback keeps debt at ₱5,000 until the cashback is applied, the statement then shows ₱4,950, the linked savings account shows ₱5,000 held for the card, and paying early leaves the ₱50 pending.

Decisions:
- Cashback timing → pending until applied manually, on the date the bank credited it; existing cashback entries stay applied.
- Payment account → each card links one active money account; the card's full owed amount is held there; card spend beyond that account's free cash warns but saves.
- Installments → out of scope for now.
- Statement accuracy → keep the estimate, add "Confirm statement" with the bank's balance, minimum due and due date; alerts prefer confirmed figures.

Rules that apply to all PH issuers (bank-specific values are entered, not coded):
- Statement cycle with a separate due date; purchases after cutoff belong to the next statement.
- Minimum amount due is generally the greater of a percentage of the balance or a fixed amount, plus installments, over-limit and past-due amounts ([BSP Circular 1098 FAQ](https://www.landbank.com/public/upload/files/BSP%201098%20-%20FAQs.pdf)). Paying only the minimum still incurs interest.
- Interest is capped at 3% per month under BSP Circular 1165 (2023); the cap's status after 2023 is unverified. Chibako records actual interest and fees from the statement rather than calculating them.
- Cashback/rewards timing and early-payment treatment vary by issuer.

## Slices

- [x] 1. Pending cashback. Cashback added to an expense is saved as earned with no balance or income effect. Apply creates the cashback income on the bank's credited date into the card or another account; un-apply returns it to pending. Reverting the expense cancels pending cashback; changing the expense amount recalculates percentage cashback. Existing rows (with an income transaction) stay applied. Expose apply/un-apply through REST and MCP and update `docs/finance/cashback.md`. Schema: `finance_cashbacks.income_id` becomes nullable; bump `SCHEMA_VERSION`. — check: Node tests for the ₱5,000/1% example (debt stays ₱5,000 and ₱50 pending; apply on the 15th makes the statement ₱4,950; a ₱5,000 early payment leaves ₱50 pending), idempotent replay and stale-version rejection, a migration test that old rows stay applied, REST/MCP protocol parity, `npm run typecheck`, `npm test`, `npm run test:mcp-stdio`.
  Evidence (2026-11-06): 603 Node tests, typecheck, lint, MCP stdio, and disposable finance browser apply/un-apply flow passed.

- [x] 2. Linked payment account with hold and warning. Credit accounts get an optional `payment_account_id` (active money account only). The card's full owed amount, not reduced by pending cashback, comes off that account's spendable amount alongside the maintaining balance and planned expenses. A card expense beyond the payment account's free cash returns a warning and still posts. The card payment form fills in the linked account. — check: tests for the spendable reduction, warn-not-block, two cards on one account adding up, rejection of credit/asset/archived links, REST/MCP warning parity; typecheck, `npm test`, a browser check on a disposable vault.
  Evidence (2026-11-06): 608 Node tests and typecheck passed; disposable browser covered payment-account selection, debt hold, and payment-source autofill.

- [x] 3. Confirmed statements and minimum due. "Confirm statement" stores the bank's statement balance, minimum due and due date for a card's statement (versioned, audited, idempotent). Due alerts use confirmed figures when present: remaining balance and remaining minimum after credits dated after the statement date, overdue only when the minimum is unpaid after the due date. The difference between the estimate and the bank's figure is shown; interest and fees are recorded as card charges. Without a confirmation, the current estimate stays. — check: tests for confirmed figures replacing the estimate, payments reducing remaining balance and minimum, overdue only on an unpaid minimum, stale-version rejection, REST/MCP parity; typecheck, `npm test`, `npm run test:mcp-stdio`, the finance Playwright flow.

Evidence (2026-11-06, final working tree): all 614 Node tests, typecheck, lint, MCP stdio, isolated production build, and all 12 finance Playwright flows passed. Independent review found future-dated payments clearing minimum-due alerts early; a failing regression test reproduced it, and the fix now bounds credits to the alert date. Browser mutation checks used disposable vaults; the existing logged-in local browser was inspected without posting financial entries.

Slices are independent. Slices 1 and 2 change the schema and may share one `SCHEMA_VERSION` bump if they ship together. Back up the production vault before deploying any of them.

## Deferred

- Card installments (full amount held against the limit, monthly portion billed per statement).
- Scheduled auto-debit transfers (plans support only income and expense today).
- Interest and late-fee calculation.
- Due dates moving when they fall on weekends or holidays (varies by issuer).
- MariBank PH's treatment of unused cashback after a full early payment is unconfirmed; pending-until-applied works either way.
