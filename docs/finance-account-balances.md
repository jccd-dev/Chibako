# Account balances

For a money account, enter opening and maintaining balances as separate portions
of the money already held. An opening of PHP 8,000 and maintaining balance of
PHP 2,000 gives an initial net balance of PHP 10,000.

- **Net balance:** opening plus maintaining balance, adjusted by posted activity.
- **Spendable:** net balance minus maintaining balance and pending expense plans due this month,
  including overdue plans earlier in this month, with a minimum of zero. Plans
  outside the current month are excluded. Pending income does not increase spendable.
- Recurring expenses count through their generated pending occurrences. Satisfied
  and cancelled plans do not reserve money. Posting an expense through its plan
  reduces net balance and releases its reservation, so it is not subtracted twice.

Maintaining balance defaults to zero for existing and imported accounts. Opening
balance stays fixed. Editing maintaining balance changes net balance by the same
difference; use a current-balance reconciliation when the bank total needs to stay
fixed. Maintaining balance is unavailable for asset accounts.

Account REST and MCP create/update inputs accept `maintaining_balance` as a
non-negative PHP decimal string. Account reads include `maintaining_balance_cents`,
`planned_expense_cents`, and `spendable_cents`. Overview reads include aggregate
`spendable_cents` for money accounts included in the summary. Reservations affect
the displayed spendable amount; existing activity recording and warning rules
continue to apply.

## Manual browser check

These checks create persistent history; use a clearly named test account.

1. Create `TEST Maintaining balance` with opening 8,000 and maintaining 2,000.
   Confirm net 10,000 and spendable 8,000 in account details and the summary.
2. Add a pending expense of 500 to that account. Confirm spendable 7,500 and net
   10,000. Use a due date within the current month. Confirm an overdue expense in
   this month is also reserved, while a next-month expense is excluded. Add a
   recurring expense and confirm its current-month pending occurrence is reserved.
3. Post the 500 expense through its plan. Confirm net 9,500 and spendable stays the same because
   the posted expense replaces its reservation. Cancel another pending expense
   and confirm that reservation is released.
4. Edit maintaining balance and current balance together. Confirm the dated
   reconciliation uses the displayed difference. Verify existing accounts still
   show their previous net balances with a zero maintaining balance.
