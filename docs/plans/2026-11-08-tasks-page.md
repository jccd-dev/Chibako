# Tasks Page

Outcome: Tasks are ordinary Notes, Notion-style: `type: task` is just a property used for filtering, never a hard scope. A `/app/tasks` table lists all Notes with property columns, opening with Type = task preset, and the calendar keeps showing all dated Notes with a "Tasks only" filter.

Problem: There is no way to filter Notes down to tasks, no table view of Notes by their properties, and undated tasks show up nowhere.

Done when: Set Type to task on an ordinary Note from the calendar drawer; it appears on `/app/tasks` under its status group; changing it to Done in the drawer moves it to the Done group without leaving the page; clearing the Type filter shows non-task Notes too; on `/app/calendar` "Tasks only" hides dated Notes that are not tasks.

Decisions:
- What makes a task → nothing structural. `type: task` is a property filter (not folder or status, which agent-memory notes also use); every view still works on any Note.
- `type` choices → `DEFAULTS_VERSION` 4 adds `task` to a stored `type` select once; a free-text `type` is left alone; Note values untouched.
- Folder → placement only. New tasks default to `<folder>/Tasks`; a folder already inside a `Tasks` folder is kept as is.
- Table view → `/app/tasks` lists all Notes (Title, Folder, Type, Status, Priority, Date), grouped by status (Status choice order, "No status" last), filters `?type=` (preset `task`, clearable) and `?folder=`, rows open the existing drawer.
- Drawer → gains a Type dropdown so any Note can be turned into a task or back; "New task" defaults Type to task.
- Calendar → all dated Notes, tasks marked, "Tasks only" toggle in `?tasks=1`.
- No backfill: earlier drawer-created tasks need `type: task` set by hand.

Out of scope: board view, drag-to-reschedule, column sorting, status/priority filters.

## Slices

- [x] 1. The task type — done: calendar e2e 5/5, npm test 667/667, lint and typecheck clean (Codex gpt-6-luna). Check: migration test covers v3 → v4 once; unit tests for `isTask` and `taskFolder`; calendar e2e asserts a drawer task has `type: task` and "Tasks only" hides an ordinary Note.
- [x] 2. Type field in the drawer — done: calendar e2e 5/5, npm test 667/667, lint and typecheck clean (Codex gpt-6-luna); drawer checked on the dev server without saving. Also: folder picker accepts any folder, with an optional Tasks subfolder (default on). Check: calendar e2e opens an ordinary Note in the drawer, sets Type to task, and "Tasks only" then shows it.
- [ ] 3. Notes table page — depends on 2 — check: new `tests/e2e/tasks.spec.ts` creates an undated task (listed under Not started), sets Done (moves to Done group), shows a Note given `type: task` through the API, hides an ordinary Note until the Type filter is cleared; then full `npm test`, `npm run typecheck`, `npm run lint`.
