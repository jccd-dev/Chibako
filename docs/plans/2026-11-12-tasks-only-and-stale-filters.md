# Tasks page shows only tasks; fix stale filters

Outcome: `/app/tasks` lists only Notes with `type: task`, always. On both Tasks and Calendar, the filters on screen always match the URL, including after in-app navigation such as the sidebar Tasks/Calendar links.
Problem: Tasks has an "All types" select, so non-task Notes can appear. Both `TasksView` and `CalendarView` copy URL filters into `useState` once and ignore new props. So after choosing "All types" (or a folder/status/priority), clicking the sidebar **Tasks** link resets the URL but keeps the old filter. This was reproduced in a throwaway Playwright run: the URL was `/app/tasks`, the select still read All types, and the `guide` note was still visible.
Done when: tasks.spec proves a non-task Note never shows on `/app/tasks` (even at `?type=all`) and that the sidebar link resets the filters. calendar.spec proves the sidebar Calendar link resets folder, Tasks only and chip filters. `npm test`, `npm run typecheck` and `npm run lint` pass.
Decisions:
- Tasks type filter → removed; the page always filters `type: task`, and `?type=` is ignored.
- Calendar → keep the existing "Tasks only" toggle (it already is [task, all]); fix only the stale state.
- Tasks drawer Type field → kept; changing a Note's type is how it leaves the table.
- Stale-state fix → remount the view with a `key` built from the requested filter params (not the date), not prop-to-state syncing. It's the smallest change, and the page's own `router.replace` filter changes already re-render the server page with fresh `initialNotes`.

## Design notes
- `src/app/app/tasks/page.tsx`: drop the `type` search param, `requestedType` and `typeOptions`; add `key={JSON.stringify([folder, status, priority])}` on `<TasksView>`.
- `src/features/calendar/components/TasksView.tsx`: remove the `type` state, `selectType`, the type `NativeSelect`, `ALL_TYPES` and the `type` arg of `tasksUrl`; call `filterTable(notes, "task", folder, choices)`. Update the subtitle (now "N tasks"; drop "Type is a filter…"). Keep the Type column? It always shows "task", so remove it and widen Title.
- `src/app/app/calendar/page.tsx`: add `key={JSON.stringify([folder, tasks, status, priority])}` on `<CalendarView>`. Leave `date` out so picking a day doesn't remount.
- `filterTable` keeps its `type` parameter (Calendar passes `"task"` or `""`); no change to `task-table.ts`.
- Risk: a remount closes an open drawer. Filters change only while the drawer is closed (it's modal), so there's no user impact. Re-check that an unsaved drawer edit isn't lost by a `chibako:notes-changed` refresh. It shouldn't be, since a refresh doesn't change the key.

## Slices
- [x] 1. Tasks page shows only tasks and resets on sidebar navigation — check: update `tests/e2e/tasks.spec.ts` lines 68–86 (drop the type select step and `type=all` from the URL asserts); add a step that opens `/app/tasks?type=all` and asserts a `type: guide` Note is hidden, then sets a folder filter, clicks the sidebar Tasks link and asserts the URL is `/app/tasks` and the filter is reset; `npm run test:e2e -- tests/e2e/tasks.spec.ts`.
- [x] 2. Calendar filters reset on sidebar navigation — independent of 1 — check: add a step to `tests/e2e/calendar.spec.ts` that turns on Tasks only plus a status chip, clicks the sidebar Calendar link, and asserts the toggle is off, the chips are cleared and non-task dated Notes are listed; `npm run test:e2e -- tests/e2e/calendar.spec.ts`; then `npm run typecheck`, `npm run lint`, `npm test`.

Slice 1 evidence: Tasks Playwright flow passed (1 test); observed regression failure at `?type=all` before the fix.

Slice 2 evidence: Tasks and Calendar Playwright suites passed (6 tests), including sidebar resets and unsaved drawer titles across notes-changed refresh; typecheck and lint passed. Calendar canonicalizes the bare sidebar URL to today’s `?date=`. Full Node suite initially passed 673/675 with two scoreboard `no_vectors` failures; isolated scoreboard recheck passed 6/6. Full-suite recheck passed 675/675. Final diff review passed; no data/auth/persistence changes. Both slices are complete locally, uncommitted.
