import { expect, test, type Page } from "@playwright/test";

/** Picks an option from a Base UI Select in the task drawer (options render in a portal). */
async function chooseTaskOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("dialog").getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function authenticate(page: Page): Promise<void> {
  const clientId = `tasks-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

test("Tasks table lists only tasks, resets filters and edits in the drawer", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  for (const data of [
    { title: `Api task ${suffix}`, folder: "Work", properties: { type: "task", status: "In progress", priority: "High" } },
    { title: `Plain ${suffix}`, folder: "Work", properties: { type: "guide", status: "Not started", priority: "Low" } },
  ]) {
    expect((await page.request.post("/api/notes", { data })).ok()).toBeTruthy();
  }

  await page.goto("/app/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  const table = page.getByTestId("tasks-table");
  await expect(table.getByRole("region", { name: "In progress" })).toContainText(`Api task ${suffix}`);
  await expect(table.getByText(`Plain ${suffix}`)).toHaveCount(0);

  // An undated task created from the table lands in its status group.
  await page.getByRole("button", { name: "New task" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Task title").fill(`Undated ${suffix}`);
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/notes" && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("chibako:notes-changed")));
  await refreshed;
  await expect(drawer.getByLabel("Task title")).toHaveValue(`Undated ${suffix}`);
  await chooseTaskOption(page, "Task status", "Not started");
  await drawer.getByRole("button", { name: "Create task" }).click();
  await expect(drawer.getByRole("status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  const notStarted = table.getByRole("region", { name: "Not started" });
  await expect(notStarted).toContainText(`Undated ${suffix}`);
  await expect(notStarted.getByRole("row").filter({ hasText: `Undated ${suffix}` })).toContainText("—");
  await expect(page).toHaveURL("/app/tasks");

  // Marking it Done moves it to the Done group without leaving the page.
  await notStarted.getByRole("button", { name: `Undated ${suffix}` }).click();
  await chooseTaskOption(page, "Task status", "Done");
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(table.getByRole("region", { name: "Done" })).toContainText(`Undated ${suffix}`);
  await expect(notStarted.getByText(`Undated ${suffix}`)).toHaveCount(0);
  await expect(page).toHaveURL("/app/tasks");

  // Legacy type parameters cannot expose non-task Notes.
  await page.goto("/app/tasks?type=all");
  await expect(table.getByText(`Plain ${suffix}`)).toHaveCount(0);
  await page.getByLabel("Filter by folder").click();
  await page.getByLabel("Search folders").fill("wor");
  await page.getByRole("option", { name: "Work", exact: true }).click();
  await expect(page).toHaveURL("/app/tasks?folder=Work");
  await expect(table.getByText(`Undated ${suffix}`)).toHaveCount(0);

  // Status and priority chips narrow the table, combine with other filters and survive a reload.
  const statusChips = page.getByRole("group", { name: "Filter by status" });
  const priorityChips = page.getByRole("group", { name: "Filter by priority" });
  await statusChips.getByRole("button", { name: "Not started" }).click();
  await statusChips.getByRole("button", { name: "In progress" }).click();
  await expect(page).toHaveURL("/app/tasks?folder=Work&status=Not+started%2CIn+progress");
  await expect(table).toContainText(`Api task ${suffix}`);
  await expect(table.getByText(`Plain ${suffix}`)).toHaveCount(0);
  await priorityChips.getByRole("button", { name: "High" }).click();
  await expect(page).toHaveURL("/app/tasks?folder=Work&status=Not+started%2CIn+progress&priority=High");
  await expect(table).toContainText(`Api task ${suffix}`);
  await expect(table.getByText(`Plain ${suffix}`)).toHaveCount(0);
  await page.reload();
  await expect(priorityChips.getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
  await expect(table.getByText(`Plain ${suffix}`)).toHaveCount(0);
  await statusChips.getByRole("button", { name: "In progress" }).click();
  await expect(table.getByText(`Api task ${suffix}`)).toHaveCount(0);
  await expect(page.getByText("No Notes match these filters")).toBeVisible();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL("/app/tasks");
  await expect(page.getByLabel("Filter by folder")).toContainText("All folders");
  await expect(statusChips.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(priorityChips.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(table).toContainText(`Undated ${suffix}`);
  await expect(table.getByText(`Plain ${suffix}`)).toHaveCount(0);
});
