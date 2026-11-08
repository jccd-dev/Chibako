# Tasks Page

Outcome: Any Note becomes a task when its `type` is `task`, wherever it lives. A `/app/tasks` page lists every task in one table grouped by status, and the calendar keeps showing all dated Notes with tasks marked.

Problem: Nothing tells a task apart from a dated Note, there is no single place to see all tasks, and undated tasks show up nowhere.

Done when: Set `type: task` on an ordinary Note from its Note page; it appears on `/app/tasks` under its status group; changing it to Done in the drawer moves it to the Done group without leaving the page; on `/app/calendar` "Tasks only" hides dated Notes that are not tasks.

Decisions:
- What makes a task → `type` property equals `task` (not folder or status, which agent-memory notes also use).
- `type` choices → `DEFAULTS_VERSION` 4 adds `task` to a stored `type` select once; a free-text `type` is left alone; Note values untouched.
- Folder → placement only. New tasks default to `<folder>/Tasks`; a folder already inside a `Tasks` folder is kept as is.
- Tasks view → one table grouped by status (Status choice order, "No status" last), `?folder=` filter, rows open the existing drawer.
- Calendar → all dated Notes, tasks marked, "Tasks only" toggle in `?tasks=1`.
- No backfill: earlier drawer-created tasks need `type: task` set by hand.

Out of scope: board view, drag-to-reschedule, column sorting, status/priority filters.

## Slices

- [x] 1. The task type — done: calendar e2e 5/5, npm test 667/667, lint and typecheck clean (Codex gpt-6-luna). Check: migration test covers v3 → v4 once; unit tests for `isTask` and `taskFolder`; calendar e2e asserts a drawer task has `type: task` and "Tasks only" hides an ordinary Note.
- [ ] 2. Tasks page — depends on 1 — check: new `tests/e2e/tasks.spec.ts` creates an undated task (listed under Not started), sets Done (moves to Done), shows a Note given `type: task` through the API, and omits an ordinary Note; then full `npm test`, `npm run typecheck`, `npm run lint`.
