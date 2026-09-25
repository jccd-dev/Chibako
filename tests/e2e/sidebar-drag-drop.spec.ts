import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page): Promise<void> {
  const clientId = `sidebar-dnd-${Date.now()}`;
  await page.route("**/api/login", route => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
  await page.goto("/app/note/new");
  if (/\/(setup|login)$/.test(page.url())) {
    const setup = /\/setup$/.test(page.url());
    await page.locator(setup ? "#setup-password" : "#login-password").fill("correct horse battery staple");
    if (setup) await page.locator("#setup-confirm").fill("correct horse battery staple");
    await page.getByRole("button", { name: setup ? "Create account" : "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
}

test("sidebar drops files into root space and open folder contents", async ({ page }) => {
  await authenticate(page);
  const folder = await page.request.post("/api/folders", { data: { path: "Projects" } });
  expect(folder.ok()).toBeTruthy();
  const response = await page.request.post("/api/notes", {
    data: { title: "Drag source", folder: "Projects", content: "" },
  });
  expect(response.ok()).toBeTruthy();
  const note = (await response.json()).note as { id: string };

  await page.goto(`/app/note/${note.id}`);
  const sidebar = page.getByRole("navigation", { name: "Files and folders" });
  const folderButton = sidebar.getByRole("button", { name: "Projects", exact: true });
  await folderButton.click();
  await expect(folderButton).toHaveAttribute("aria-expanded", "true");

  const rootScope = sidebar.locator("nav > div").last();
  const sourceRow = sidebar.getByRole("link", { name: "Drag source", exact: true })
    .locator("xpath=ancestor::div[@draggable='true'][1]");
  const rootBox = await rootScope.boundingBox();
  if (!rootBox) throw new Error("Root drop area is not visible.");
  await sourceRow.dragTo(rootScope, { targetPosition: { x: rootBox.width / 2, y: rootBox.height - 8 } });
  await expect.poll(async () => {
    const result = await page.request.get(`/api/notes/${note.id}`);
    return ((await result.json()).note as { folder: string }).folder;
  }).toBe("");

  const folderScope = folderButton.locator("xpath=ancestor::div[contains(@class, 'group/sidebar-row')]/following-sibling::div");
  const folderBox = await folderScope.boundingBox();
  if (!folderBox) throw new Error("Open folder drop area is not visible.");
  const rootSourceRow = sidebar.getByRole("link", { name: "Drag source", exact: true })
    .locator("xpath=ancestor::div[@draggable='true'][1]");
  await rootSourceRow.dragTo(folderScope, { targetPosition: { x: folderBox.width / 2, y: folderBox.height / 2 } });
  await expect.poll(async () => {
    const result = await page.request.get(`/api/notes/${note.id}`);
    return ((await result.json()).note as { folder: string }).folder;
  }).toBe("Projects");
});
