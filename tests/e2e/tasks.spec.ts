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

test("Tasks table lists Notes by Type, groups by status and edits in the drawer", async ({ page }) => {
  await authenticate(page);
  const suffix = Date.now();
  for (const data of [
    { title: `Api task ${suffix}`, folder: "Work", properties: { type: "task", status: "In progress" } },
    { title: `Plain ${suffix}`, folder: "Work", properties: { status: "Not started" } },
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

  // Type is only a filter: clearing it shows the ordinary Note too.
  await page.getByLabel("Filter by type").selectOption("");
  await expect(page).toHaveURL("/app/tasks?type=all");
  await expect(table.getByRole("region", { name: "Not started" })).toContainText(`Plain ${suffix}`);
  await page.getByLabel("Filter by folder").selectOption("Work");
  await expect(page).toHaveURL("/app/tasks?type=all&folder=Work");
  await expect(table.getByText(`Undated ${suffix}`)).toHaveCount(0);
});
