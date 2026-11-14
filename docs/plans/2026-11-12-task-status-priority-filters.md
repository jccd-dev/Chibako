# Task status and priority filters

Outcome: On Tasks and Calendar, JC can narrow to any combination of statuses and priorities in a click or two, and the view survives reload and bookmarks.
Problem: Neither page filters by status or priority. Tasks only filters by type/folder and sorts by date; priority is display-only. Calendar has only "Tasks only" and folder. Done items are dimmed, never hidden.
Done when: `/app/tasks?status=Not started,In progress&priority=High` and the equivalent Calendar URL show only matching Notes, the Calendar grid day counts follow the filters, and Tasks groups list High priority first. Covered by Node tests and the tasks/calendar e2e specs.
Decisions:
- Status control → multi-select Toggle chips (any combination, e.g. everything but Done).
- Priority → chip filter like status, and sort within each status group High → Medium → Low → none, then date, then title.
- Calendar → same filters as Tasks, via the shared filter function and control.
- Filtering stays client-side (both pages already hold every Note); no API, SQL, or migration change.
- URL → `?status=a,b&priority=c`; comma separator (no option contains one); empty = any; case-insensitive match.
- Priority rank comes from the reversed priority option order in property defs, not hardcoded.
- Calendar day-list sort (pinned, title) is unchanged.

## Design notes
- `src/features/calendar/task-table.ts`: `filterTable(notes, type, folder, choices)` takes `ChoiceFilters` (`{ status: [...], priority: [...] }`); `parseChoices(value, options)` parses URL values; `groupByStatus` takes priority options for the sort.
- New `src/features/calendar/components/ChoiceFilter.tsx`: multi-select `ToggleGroup` chips (group named "Filter by status|priority"), options from `options("status")` / `options("priority")`, off-list URL values kept visible.
- Parse params in `src/app/app/tasks/page.tsx` and `src/app/app/calendar/page.tsx`; extend `tasksUrl` (`TasksView.tsx`) and `calendarUrl` (`CalendarView.tsx`).
- Calendar replaces its inline filter at `CalendarView.tsx:40` with the shared one; grid counts already derive from the filtered list (`DatedNotesCalendar.tsx:99`).
- Risk: header crowding on narrow screens; confirm chips wrap without pushing content below the fold.
- Check the Tasks empty state reads sensibly when filters exclude everything.

## Slices
- [x] 1. Tasks page: status/priority chip filters, URL params, High-first sort within groups — check: new cases in `tests/task-table.test.ts` (multi-status, priority, High-first sort, empty = any) pass; `npm run test:e2e -- tests/e2e/tasks.spec.ts` with a step toggling a chip and asserting URL and rows.
  - Evidence (2026-11-12, uncommitted): task-table tests 5/5, tasks.spec e2e passed, `npm test` 675/675, typecheck + lint clean; desktop and iPhone SE checked on localhost:3000.
- [x] 2. Calendar: same shared filter and chips, `calendarUrl` params, grid counts follow — depends on 1 — check: `npm run test:e2e -- tests/e2e/calendar.spec.ts` with a step asserting a status filter narrows the day list and grid count; then `npm run typecheck`, `npm run lint`, `npm test`.
  - Evidence (2026-11-12, uncommitted): calendar.spec 4/4 (new step: chips narrow day list + grid count, reload keeps them), tasks.spec passed, `npm test` 675/675, typecheck + lint clean; localhost:3000 redirect keeps filters (screenshot tool timed out, layout not visually rechecked).
