# Ticket 12 owner browser checks

Run on your existing local dev server and dev Vault. Use clearly named `TEST 12`
fixtures, never personal accounts. Test accounts, schedules, obligations and
activity history persist. These checks are pending; automated verification uses
temporary SQLite vaults and does not mutate the running dev Vault.

1. Create a `TEST 12 cash` money account with PHP 100 opening and a `TEST 12 debt`
   obligation with PHP 30 principal. Add an expense schedule, PHP 10 monthly,
   linked to this debt. Refresh due occurrences. Confirm cash remains PHP 100
   and outstanding principal remains PHP 30.
2. Open a linked pending occurrence. Confirm the panel shows PHP 30 outstanding.
   Review PHP 10 principal, actual account/date, and PHP 2 explicit expense
   interest/fee. Post. Expect cash PHP 88, principal PHP 20, satisfied occurrence,
   and only PHP 2 actual spending. The due date must remain separate from the
   actual transaction date.
3. Try principal above PHP 20 on another pending occurrence. Expect rejection and
   no cash/progress change. Refresh after a stale review before submitting new
   values. Retrying unchanged fields must not create a second payment.
4. In Activity, correct that payment to PHP 12 principal and PHP 3 fee. Expect
   cash PHP 85, outstanding PHP 18, and PHP 3 spending. Change the account or
   actual date: both principal and linked fee should move together.
5. Delete that payment. Expect payment progress, cash and occurrence satisfaction
   unchanged. Use Activity's hidden filter, then Revert. Expect original cash,
   PHP 30 outstanding, cancelled spending effects, and reopened pending review.
6. Record a compatible ordinary cash expense first. In recurring payment review,
   explicitly link that existing cash with matching amount/account/date. Expect
   principal progress once and no additional cash movement. Separately, match an
   already recorded principal payment of the same obligation to a pending
   occurrence; neither cash nor principal should change again. Reuse on a second
   occurrence must fail.
7. Repeat with a `TEST 12 receivable` and an income schedule. Collection increases
   cash and reduces principal; only separately entered interest counts as income.
8. Pause, resume, catch up, skip, and edit one occurrence or this and future
   occurrences. Confirm no automatic payment or balance changes. Future
   association edits must preserve satisfied history.
9. Repeat the review/post/correction flow at desktop and narrow mobile widths.
   Check labels, keyboard focus, scrolling, errors and no horizontal overflow.
