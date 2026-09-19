import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
  const clientId = `calendar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/login", (route) => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/note/new");
  if (/\/setup$/.test(page.url())) {
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
  folder?: string;
  kind?: "note" | "wiki" | "index";
  pinned?: boolean;
}): Promise<{ id: string }> {
  const response = await page.request.post("/api/notes", {
    data: {
      title: input.title,
      folder: input.folder,
      kind: input.kind ?? "note",
      properties: { date: input.date },
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
  const selectedNotes = page.getByTestId("calendar-note-list").getByRole("link");
  await expect(selectedNotes).toHaveCount(2);
  await expect(selectedNotes.nth(0)).toContainText(`Alpha ${suffix}`);
  await expect(selectedNotes.nth(0)).toContainText("wiki");
  await expect(selectedNotes.nth(1)).toContainText(`Zebra ${suffix}`);
  await expect(selectedNotes.nth(1)).toContainText("Work");
  await expect(page.getByRole("button", { name: new RegExp(`February 3, ${year}, 2 Notes`) })).toBeVisible();
  await expect(page.getByTestId("calendar-note-list").getByText(`Impossible ${suffix}`)).not.toBeVisible();

  await page.getByRole("button", { name: new RegExp(`February 4, ${year}, 1 Note`) }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${year}-02-04`);
  await expect(page.getByTestId("calendar-note-list").getByText(`Other day ${suffix}`)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`February 3, ${year}, 1 Note`) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`February 4, ${year}, 1 Note`) }).click();
  await expect(page).toHaveURL(`/app/calendar?date=${year}-02-04`);

  await page.goto(`/app/note/${undated.id}`);
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(page.locator('[data-slot="calendar"]')).toHaveCount(0);
});

test("Calendar starts a dated draft without creating an abandoned Note", async ({ page }) => {
  await authenticate(page);
  const year = 6000 + Date.now() % 1000;
  const selectedDate = `${year}-06-15`;
  let creates = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/notes")) creates += 1;
  });

  await page.goto(`/app/calendar?date=${selectedDate}`);
  await page.getByRole("button", { name: "New note" }).click();

  await expect(page).toHaveURL(`/app/note/new?date=${selectedDate}`);
  await expect(page.getByRole("textbox", { name: "Property date" })).toHaveValue(selectedDate);
  await page.waitForTimeout(900);
  expect(creates).toBe(0);

  await page.getByRole("textbox", { name: "Note title" }).fill(`Dated draft ${Date.now()}`);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveText("Saved", { timeout: 15_000 });
  expect(creates).toBe(1);
  await expect(page.getByRole("textbox", { name: "Property date" })).toHaveValue(selectedDate);
});
