import { expect, test, type Locator, type Page } from "@playwright/test";

/** Picks an option from a Base UI Select in the task drawer (options render in a portal). */
async function chooseTaskOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("dialog").getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function authenticate(page: Page): Promise<void> {
  const clientId = `calendar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/login", (route) => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/note/new");
  if (/\/setup$/.test(page.url())) {
    await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
    await page.locator("#setup-password").fill("correct horse battery staple");
    await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
  } else if (/\/login$/.test(page.url())) {
    await page.locator("#login-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
}

async function createDatedNote(page: Page, input: {
  title: string;
  date: string;
  endDate?: string;
  folder?: string;
  kind?: "note" | "wiki" | "index";
  pinned?: boolean;
}): Promise<{ id: string }> {
  const response = await page.request.post("/api/notes", {
    data: {
      title: input.title,
      folder: input.folder,
      kind: input.kind ?? "note",
      properties: input.endDate ? { date: input.date, end_date: input.endDate } : { date: input.date },
    },
  });
  expect(response.ok()).toBeTruthy();
  const note = (await response.json()).note as { id: string };
  if (input.pinned) {
    const pin = await page.request.patch(`/api/notes/${note.id}`, { data: { is_pinned: 1 } });
    expect(pin.ok()).toBeTruthy();
  }
  return note;
}

/** Grid cell for a day; pills render inside the cell where their week segment starts. */
const dayCell = (page: Page, day: string) => page.locator("td", { has: page.locator(`[data-note-date="${day}"]`) });

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  // The grid remounts its cells on every render, so a found element can be replaced before it is measured.
  for (let attempt = 0; attempt < 50; attempt++) {
    const box = await locator.boundingBox();
    if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await locator.page().waitForTimeout(100);
  }
  throw new Error("Element has no box");
}

async function mouseDrag(page: Page, from: Locator, to: Locator): Promise<void> {
  const start = await center(from);
  const end = await center(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function savedRange(page: Page, id: string) {
  const { note } = await (await page.request.get(`/api/notes/${id}`)).json() as { note: { properties: Record<string, unknown> } };
  return { date: note.properties.date, end_date: note.properties.end_date };
}

test("Calendar groups valid Note dates and lists the selected day", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  const year = 3000 + suffix % 5000;
  const selectedDate = `${year}-02-03`;
  await createDatedNote(page, { title: `Zebra ${suffix}`, date: selectedDate, folder: "Work" });
  await createDatedNote(page, { title: `Alpha ${suffix}`, date: selectedDate, kind: "wiki", pinned: true });
  await createDatedNote(page, { title: `Other day ${suffix}`, date: `${year}-02-04` });
  await createDatedNote(page, { title: `Impossible ${suffix}`, date: `${year}-02-30` });

  await page.goto(`/app/calendar?date=${selectedDate}`);

  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page).toHaveURL(`/app/calendar?date=${selectedDate}`);
  const selectedNotes = page.getByTestId("calendar-note-list").getByRole("listitem");
  await expect(selectedNotes).toHaveCount(2);
  await expect(selectedNotes.nth(0)).toContainText(`Alpha ${suffix}`);
  await expect(selectedNotes.nth(0)).toContainText("wiki");
  await expect(selectedNotes.nth(1)).toContainText(`Zebra ${suffix}`);
  await expect(selectedNotes.nth(1)).toContainText("Work");
  await expect(page.getByRole("button", { name: new RegExp(`February 3, ${year}, 2 Notes`) })).toBeVisible();
  await expect(page.getByTestId("calendar-note-list").getByText(`Impossible ${suffix}`)).not.toBeVisible();
  // A Note with only `date` still draws a pill in its grid cell.
  await expect(dayCell(page, `${year}-02-04`).getByTestId("calendar-pill").filter({ hasText: `Other day ${suffix}` })).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`February 4, ${year}, 1 Note`) }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${year}-02-04`);
  await expect(page.getByTestId("calendar-note-list").getByText(`Other day ${suffix}`)).toBeVisible();
});

test("Calendar spans a Note across its inclusive date range", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  const year = 4000 + suffix % 1000;
  await createDatedNote(page, { title: `Trip ${suffix}`, date: `${year}-03-30`, endDate: `${year}-04-02` });
  await createDatedNote(page, { title: `Backwards ${suffix}`, date: `${year}-03-31`, endDate: `${year}-03-01` });

  for (const day of [`${year}-03-30`, `${year}-03-31`, `${year}-04-02`]) {
    await page.goto(`/app/calendar?date=${day}`);
    await expect(page.getByTestId("calendar-note-list").getByText(`Trip ${suffix}`)).toBeVisible();
  }
  // The random year decides whether April's grid shows March 31, so view March.
  await page.goto(`/app/calendar?date=${year}-03-31`);
  await expect(page.getByRole("button", { name: new RegExp(`March 31, ${year}, 2 Notes`) })).toBeVisible();

  await page.goto(`/app/calendar?date=${year}-04-03`);
  await expect(page.getByTestId("calendar-note-list").getByText(`Trip ${suffix}`)).toHaveCount(0);
  await page.goto(`/app/calendar?date=${year}-03-01`);
  await expect(page.getByTestId("calendar-note-list").getByText(`Backwards ${suffix}`)).toHaveCount(0);
});

test("Connections shows Calendar only for a dated Note and opens the selected day", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  const year = 8000 + suffix % 1000;
  const dated = await createDatedNote(page, { title: `Dated ${suffix}`, date: `${year}-02-03` });
  await createDatedNote(page, { title: `Nearby ${suffix}`, date: `${year}-02-04` });
  const undatedResponse = await page.request.post("/api/notes", { data: { title: `Undated ${suffix}` } });
  const undated = (await undatedResponse.json()).note as { id: string };

  await page.goto(`/app/note/${dated.id}`);
  await expect(page.getByRole("complementary", { name: "Note details" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`February 3, ${year}, 1 Note`) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`February 4, ${year}, 1 Note`) }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${year}-02-04`);

  await page.goto(`/app/note/${undated.id}`);
  await expect(page.getByRole("complementary", { name: "Note details" })).toBeVisible();
  await expect(page.locator('[data-slot="calendar"]')).toHaveCount(0);
});

test("Calendar creates, edits and filters a task without leaving the page", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  const year = 7000 + suffix % 1000;
  const day = `${year}-05-12`;
  const folder = await page.request.post("/api/folders", { data: { path: "Projects/Acme" } });
  expect([201, 409]).toContain(folder.status());
  await createDatedNote(page, { title: `Elsewhere ${suffix}`, date: day, folder: "Work" });

  await page.goto(`/app/calendar?date=${day}`);
  await page.getByRole("button", { name: "Add note or task" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Task title").fill(`Ship ${suffix}`);
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/calendar" && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("chibako:notes-changed")));
  await refreshed;
  await expect(drawer.getByLabel("Task title")).toHaveValue(`Ship ${suffix}`);
  await drawer.getByLabel("Task body").locator("[contenteditable=true]").fill(`Body ${suffix}`);
  // The folder picker searches anywhere in the path.
  await drawer.getByLabel("Task folder", { exact: true }).click();
  await page.getByLabel("Search folders").fill("acme");
  await expect(page.getByRole("option", { name: "Work", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Projects/Acme", exact: true }).click();
  await expect(drawer.getByTestId("task-target-folder")).toHaveText("Saves to Projects/Acme/Tasks");
  await drawer.getByRole("checkbox", { name: "Put it in a Tasks subfolder" }).click();
  await expect(drawer.getByTestId("task-target-folder")).toHaveText("Saves to Projects/Acme");
  await drawer.getByRole("checkbox", { name: "Put it in a Tasks subfolder" }).click();
  await expect(drawer.getByLabel("Task type", { exact: true })).toHaveText("task");
  await chooseTaskOption(page, "Task status", "Not started");
  await chooseTaskOption(page, "Task priority", "High");
  await drawer.getByRole("button", { name: "Create task" }).click();
  await expect(drawer.getByRole("status")).toHaveText("Saved");
  await expect(page).toHaveURL(`/app/calendar?date=${day}`);

  const folders = (await (await page.request.get("/api/folders")).json()).folders as string[];
  expect(folders).toContain("Projects/Acme/Tasks");
  const dated = (await (await page.request.get("/api/calendar")).json()).notes as { id: string; title: string; properties: Record<string, unknown> }[];
  const shipped = dated.find((n) => n.title === `Ship ${suffix}`);
  expect(shipped?.properties.type).toBe("task");
  const shippedNote = (await (await page.request.get(`/api/notes/${shipped?.id}`)).json()).note as { content: string };
  expect(shippedNote.content).toContain(`Body ${suffix}`);

  // The modal drawer hides the page from the accessibility tree, so check the row once it closes.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  const list = page.getByTestId("calendar-note-list");
  const row = list.getByRole("listitem").filter({ hasText: `Ship ${suffix}` });
  await expect(row).toContainText("Projects/Acme/Tasks");
  await expect(row).toContainText("Not started");
  await expect(row).toContainText("High");

  await row.getByRole("button").click();
  await chooseTaskOption(page, "Task status", "Done");
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(row).toContainText("Done");

  await row.getByRole("button").click();
  await expect(page.getByRole("dialog").getByLabel("Task status", { exact: true })).toHaveText("Done");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await expect(list.getByText(`Elsewhere ${suffix}`)).toBeVisible();
  await page.getByRole("button", { name: "Tasks only" }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}&tasks=1`);
  await expect(row).toBeVisible();
  await expect(list.getByText(`Elsewhere ${suffix}`)).toHaveCount(0);
  await page.getByRole("button", { name: "Tasks only" }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}`);
  await expect(list.getByText(`Elsewhere ${suffix}`)).toBeVisible();

  // Any Note becomes a task by setting its Type in the drawer.
  await list.getByRole("listitem").filter({ hasText: `Elsewhere ${suffix}` }).getByRole("button").click();
  await chooseTaskOption(page, "Task type", "task");
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Tasks only" }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}`);
  await expect(list.getByText(`Elsewhere ${suffix}`)).toBeVisible();
  await page.getByRole("button", { name: "Tasks only" }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}`);

  // The folder picked in the drawer is offered first as a recent folder.
  await page.getByLabel("Filter by folder").click();
  await page.getByRole("group", { name: "Recent" }).getByRole("option", { name: "Projects/Acme", exact: true }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}&folder=Projects%2FAcme`);
  await expect(row).toBeVisible();
  await expect(list.getByText(`Elsewhere ${suffix}`)).toHaveCount(0);
  // Status and priority chips narrow the day list and the grid counts, and survive a reload.
  await page.getByLabel("Filter by folder").click();
  await page.getByRole("option", { name: "All folders", exact: true }).click();
  await expect(list.getByText(`Elsewhere ${suffix}`)).toBeVisible();
  const dayCell = (count: string) => page.getByRole("button", { name: `May 12, ${year}${count}`, exact: true });
  await expect(dayCell(", 2 Notes")).toBeVisible();
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}&status=Done`);
  await expect(row).toBeVisible();
  await expect(list.getByText(`Elsewhere ${suffix}`)).toHaveCount(0);
  await expect(dayCell(", 1 Note")).toBeVisible();
  await page.getByRole("group", { name: "Filter by priority" }).getByRole("button", { name: "Low" }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}&status=Done&priority=Low`);
  await expect(list.getByText(`Ship ${suffix}`)).toHaveCount(0);
  await expect(dayCell("")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Filter by priority" }).getByRole("button", { name: "Low" })).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByText(`Ship ${suffix}`)).toHaveCount(0);
  await page.getByRole("group", { name: "Filter by priority" }).getByRole("button", { name: "High" }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${day}&status=Done&priority=Low%2CHigh`);
  await expect(list.getByText(`Ship ${suffix}`)).toBeVisible();
});

test("Calendar sidebar resets folder, task and chip filters", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  const today = new Date().toLocaleDateString("en-CA");
  await createDatedNote(page, { title: `Reset ordinary ${suffix}`, date: today, folder: "Work" });
  await page.goto(`/app/calendar?date=${today}`);
  await page.getByLabel("Filter by folder").click();
  await page.getByRole("option", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: "Tasks only" }).click();
  const status = page.getByRole("group", { name: "Filter by status" });
  const priority = page.getByRole("group", { name: "Filter by priority" });
  await status.getByRole("button", { name: "Done" }).click();
  await priority.getByRole("button", { name: "High" }).click();
  await expect(page.getByTestId("calendar-note-list").getByText(`Reset ordinary ${suffix}`)).toHaveCount(0);
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${today}`);
  await expect(page.getByLabel("Filter by folder")).toContainText("All folders");
  await expect(page.getByRole("button", { name: "Tasks only" })).toHaveAttribute("aria-pressed", "false");
  await expect(status.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(priority.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(page.getByTestId("calendar-note-list").getByText(`Reset ordinary ${suffix}`)).toBeVisible();
});

test("Calendar drags a pill to move it and drags its edges to resize the range", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  const year = 5000 + suffix % 1000;
  const title = `Drag ${suffix}`;
  const { id } = await createDatedNote(page, { title, date: `${year}-06-10` });
  await page.goto(`/app/calendar?date=${year}-06-10`);
  // Server-rendered pills appear before their drag handlers hydrate.
  await page.waitForLoadState("networkidle");
  const pills = page.getByTestId("calendar-pill").filter({ hasText: title });

  await mouseDrag(page, pills.first(), page.locator(`[data-note-date="${year}-06-12"]`));
  await expect.poll(() => savedRange(page, id)).toEqual({ date: `${year}-06-12`, end_date: undefined });
  // The drop must not also open the Note drawer.
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await mouseDrag(page, pills.getByTestId("calendar-pill-end"), page.locator(`[data-note-date="${year}-06-15"]`));
  await expect.poll(() => savedRange(page, id)).toEqual({ date: `${year}-06-12`, end_date: `${year}-06-15` });

  // Dragging the start past the end collapses to one day and removes end_date.
  await mouseDrag(page, pills.getByTestId("calendar-pill-start"), page.locator(`[data-note-date="${year}-06-20"]`));
  await expect.poll(() => savedRange(page, id)).toEqual({ date: `${year}-06-15`, end_date: undefined });

  await page.reload();
  await expect(dayCell(page, `${year}-06-15`).getByTestId("calendar-pill").filter({ hasText: title })).toBeVisible();
  // A plain click still opens the Note.
  await pills.first().click();
  await expect(page.getByRole("dialog").getByLabel("Task title")).toHaveValue(title);
});

test.describe("on a touch tablet", () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 1366 } });

  test("Calendar moves a pill after a long press and ignores a quick swipe", async ({ page }) => {
    await authenticate(page);
    const suffix = Date.now();
    const year = 6000 + suffix % 1000;
    const title = `Touch ${suffix}`;
    const { id } = await createDatedNote(page, { title, date: `${year}-06-10` });
    await page.goto(`/app/calendar?date=${year}-06-10`);
    await page.waitForLoadState("networkidle");
    const pill = page.getByTestId("calendar-pill").filter({ hasText: title }).first();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", point?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [point] : [] });
    const touchDrag = async (target: string, holdMs: number) => {
      const start = await center(pill);
      const end = await center(page.locator(`[data-note-date="${target}"]`));
      await touch("touchStart", start);
      await page.waitForTimeout(holdMs);
      for (let step = 1; step <= 8; step++) {
        await touch("touchMove", { x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 });
      }
      await touch("touchEnd");
    };

    await touchDrag(`${year}-06-13`, 0);
    await page.waitForTimeout(300);
    expect(await savedRange(page, id)).toEqual({ date: `${year}-06-10`, end_date: undefined });

    await touchDrag(`${year}-06-13`, 400);
    await expect.poll(() => savedRange(page, id)).toEqual({ date: `${year}-06-13`, end_date: undefined });
  });
});
