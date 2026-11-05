# Calendar Tasks

Outcome: From `/app/calendar` you can create, open and edit tasks in a half-screen drawer without leaving the page. Each task sits in a project or client folder, and status and priority are picked from dropdowns whose choices you edit in Settings → Properties.

Problem: The calendar only lists dated Notes. Opening or creating one leaves the calendar. The vault's property dictionary stores `status` as `string`, so it is free text, and there is no `priority`.

Done when: On `/app/calendar`, you pick a day, choose `Projects/Acme`, enter a title, set status "Not started" and priority "High", and save. The task appears on that day, `Projects/Acme/Tasks` exists, and the URL never left `/app/calendar`. A status option added in Settings → Properties then appears in the drawer's dropdown.

Decisions:
- What a task is → an ordinary Note with `date`, `status` and `priority` properties. No new Note kind, no table or schema change.
- Status choices → a `select` with Not started / In progress / Done by default. Choices stay editable in Settings → Properties (that editor already exists, `SettingsView.tsx:352`).
- How existing vaults get the dropdown → a one-time code upgrade: bump `DEFAULTS_VERSION` so a `status` stored as `string` becomes the default `select`, and add `priority`. Only the definition changes; Note values are untouched.
- Drawer contents → a task form (title, folder, date/end date, status, priority) and a rich-text body with autosave through `useNoteEditorSession`, plus an "Open full note" link. `NoteClient` is not embedded, because it navigates away when it saves.
- Calendar organization → a single folder filter (includes subfolders, kept in `?folder=`) and status/priority badges on day-list rows.
- Folder rule → if the chosen folder is `Tasks` or ends in `/Tasks`, use it as is; otherwise use `<folder>/Tasks`; the vault root maps to `Tasks`. `createNote` already creates missing folders (`src/lib/notes.ts:153`).

Out of scope for now: week/day views, recurring tasks, reminders, drag-to-reschedule, status/priority filters, a separate task status field.

## Slices

- [ ] 1. Status and priority dropdowns
  - In `src/lib/property-types.ts`, set the default `status` to `select` with `Not started`, `In progress`, `Done`, and add `priority` as a `select` with `Low`, `Medium`, `High`.
  - In `src/lib/properties.ts`, bump `DEFAULTS_VERSION`. During that one-time upgrade, replace a stored `status` whose type is `string` with the default select, and still merge in any missing defaults. A `status` that is already a select keeps its own options.
  - In the Note property editor (`NoteClient.tsx:859`) and the new drawer, if a Note's current value isn't one of the options (for example an old `active`, or an option later renamed in Settings), show it as an extra choice so it isn't blanked out.
  - Update the agent guide wording for `status` in `src/features/schema/knowledge-schema.ts` (lines 37 and 123).
  - Check: extend `tests/property-defaults-migration.test.ts` to cover a string `status` being upgraded exactly once, a select `status` keeping its options, and `priority` being added. Run `npm run typecheck`. Confirm that editing status options in Settings → Properties shows up in the Note's dropdown.

- [ ] 2. Task drawer on the calendar — depends on 1
  - Add a `TaskDrawer` component under `src/features/calendar/components/`, built on `Sheet` and `useNoteEditorSession`, with the rich-text editor for the body. It reads the option lists from `/api/properties` and the folders from `/api/folders`.
  - "New task" (prefilled with the selected day) opens the drawer, and so does clicking a row in the day list or a pill on the grid. "Open full note" goes to `/app/note/<id>`.
  - Put the folder rule in a small pure function next to the calendar code and give it a unit test.
  - If a save fails or is still pending, closing the drawer keeps the edits instead of dropping them, as the Note page does today. Saves emit `chibako:notes-changed`, so the calendar refreshes.
  - Check: the folder-rule unit test, plus `tests/e2e/calendar.spec.ts`. The spec creates a task in `Projects/Acme`, asserts the URL is still `/app/calendar`, the task is listed on that day, and `Projects/Acme/Tasks` exists. It then reopens the task, changes its status, and asserts the change persisted. Run with `npm run test:e2e -- tests/e2e/calendar.spec.ts`.

- [ ] 3. Folder filter and badges — depends on 2
  - Add one folder picker that filters both the month grid and the day list (subfolders included), kept in the URL as `?folder=`.
  - Show status and priority badges on day-list rows, and show Done tasks muted.
  - Check: the e2e spec filters to `Projects/Acme` and only that folder's tasks remain. Then run the full `npm test`, `npm run typecheck` and `npm run lint`.

## Risks

- The slice 1 upgrade changes `status` from text to a dropdown in every vault once it updates. Note values are kept, and any value not in the list stays visible because of the extra-choice fallback.
- Renaming or removing an option in Settings doesn't rewrite Notes that already use it. Those Notes keep the old value, which shows up as the extra choice.
