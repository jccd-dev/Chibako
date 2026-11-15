import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("Home shows the dashboard without the file panel", async ({ page }) => {
  await page.goto("/app");
  if (/\/setup$/.test(page.url())) {
    await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
    await page.locator("#setup-password").fill("correct horse battery staple");
    await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
  } else if (/\/login$/.test(page.url())) {
    await page.locator("#login-password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app$/);

  const stamp = Date.now();
  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const create = (title: string, date: string) => page.request.post("/api/notes", {
    data: { title, folder: "Tasks", content: `---\ntype: task\nstatus: Not started\ndate: ${date}\n---\n` },
  });
  expect((await create(`Home due ${stamp}`, day(0))).ok()).toBe(true);
  expect((await create(`Home late ${stamp}`, day(-2))).ok()).toBe(true);
  expect((await create(`Home soon ${stamp}`, day(2))).ok()).toBe(true);
  const pinned = await page.request.post("/api/notes", { data: { title: `Home pinned ${stamp}`, content: "kept close" } });
  const pinnedId = (await pinned.json() as { note: { id: string } }).note.id;
  expect((await page.request.patch(`/api/notes/${pinnedId}`, { data: { is_pinned: 1 } })).ok()).toBe(true);
  expect((await page.request.post("/api/finance/accounts", {
    data: { request_id: randomUUID(), name: `HOME cash ${stamp}`, kind: "money", currency: "PHP", opening_balance: "1500" },
  })).ok()).toBe(true);
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Files and folders" })).toHaveCount(0);
  const glance = page.getByRole("region", { name: "Today at a glance" });
  await expect(glance.getByText(/overdue tasks? waiting on you/)).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`Home due ${stamp}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`Home late ${stamp}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`Home soon ${stamp}`) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Home pinned ${stamp}`) }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Not started/ })).toBeVisible();
  await expect(page.getByText("Net balance")).toBeVisible();
  await expect(page.getByText("This month", { exact: true })).toBeVisible();
  await expect(page.getByText("New this week")).toBeVisible();

  // Home never shows the file panel: no toggle, and Files leaves for the notes area with the tree open.
  await expect(page.getByRole("button", { name: /left sidebar/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/note/);
  await expect(page.getByRole("navigation", { name: "Files and folders" })).toBeVisible();

  // Closing the last tab leaves an empty editor with the file tree still open.
  await page.goto("/app");
  await page.evaluate(() => localStorage.setItem("chibako_note_tabs", "[]"));
  await page.goto(`/app/note/${pinnedId}`);
  await page.getByRole("button", { name: /^Close .* tab$/ }).click();
  await expect(page).toHaveURL(/\/app\/note$/);
  await expect(page.getByText("No note open")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Files and folders" })).toBeVisible();
});
