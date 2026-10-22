import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const updaterDir = process.env.CHIBAKO_E2E_UPDATER_DIR ?? "";

async function authenticate(page: Page): Promise<void> {
  const clientId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/login", (route) => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": clientId },
  }));
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
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
}

function publish(operation: object | null) {
  const status = {
    v: 1, protocol: 1, heartbeatAt: Date.now(), checkedAt: Date.now(), currentVersion: "0.1.1",
    latest: { version: "0.1.2", notes: "Faster search", publishedAt: "2026-10-21T00:00:00Z", url: "https://github.com/jccd-dev/chibako/releases/tag/v0.1.2" },
    checkError: null, operation,
  };
  fs.writeFileSync(path.join(updaterDir, "out", "status.json"), JSON.stringify(status));
}

test("owner sees the available update, requests it, follows progress, and gets the updater's failure reason", async ({ page }) => {
  await authenticate(page);
  for (const name of fs.readdirSync(path.join(updaterDir, "in"))) fs.rmSync(path.join(updaterDir, "in", name));
  publish(null);
  await page.reload();

  await expect(page.getByRole("button", { name: "Update", exact: true })).toContainText("Update available");
  await expect(page.getByText("v0.1.2").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveAccessibleDescription("Update available: v0.1.2");
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("href", "/app/settings");
  const row = page.getByRole("button", { name: "Update", exact: true });
  await row.click();
  await expect(page.getByText("Faster search")).toBeVisible();
  expect(fs.readdirSync(path.join(updaterDir, "in"))).toHaveLength(0);
  await page.getByRole("button", { name: "Update now" }).click();

  await expect(page.getByText("Updating to v0.1.2")).toBeVisible();
  const requests = fs.readdirSync(path.join(updaterDir, "in"));
  expect(requests).toHaveLength(1);
  expect(JSON.parse(fs.readFileSync(path.join(updaterDir, "in", requests[0]), "utf8"))).toMatchObject({ action: "update", version: "0.1.2" });

  const operation = { id: "11111111-1111-4111-8111-111111111111", from: "0.1.1", to: "0.1.2", updatedAt: Date.now() };
  publish({ ...operation, phase: "snapshotting", error: null });
  await expect(page.getByText("Backing up your vault")).toBeVisible();

  publish({ ...operation, phase: "rolled_back", error: "The new version did not become healthy." });
  await expect(page.getByRole("alert").filter({ hasText: "The new version did not become healthy." })).toBeVisible();
});

test("successful update preserves unsaved settings until reload is explicitly confirmed", async ({ page }) => {
  await authenticate(page);
  for (const name of fs.readdirSync(path.join(updaterDir, "in"))) fs.rmSync(path.join(updaterDir, "in", name));
  publish(null);
  let completed = false;
  await page.route("**/api/updates", async (route) => {
    if (route.request().method() === "GET" && completed) {
      await route.fulfill({ json: { state: "current", currentVersion: "0.1.2", latest: null, operation: null, message: null } });
      return;
    }
    await route.continue();
  });
  await page.goto("/app/settings");
  const schema = page.getByRole("textbox").first();
  await expect(schema).toBeVisible();
  await expect(schema).toHaveValue(/# Chibako Vault Schema/);
  await schema.fill("Unsaved update regression fixture");

  await page.getByRole("button", { name: "Update", exact: true }).click();
  await page.getByRole("button", { name: "Update now" }).click();
  await expect(page.getByText("Updating to v0.1.2")).toBeVisible();
  completed = true;

  await expect(page.getByText("Chibako 0.1.2 is installed.")).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(schema).toHaveValue("Unsaved update regression fixture");
  await page.getByRole("button", { name: "Reload Chibako" }).click();
  await expect(page.getByRole("dialog")).toContainText("not saved yet");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(schema).toHaveValue("Unsaved update regression fixture");

  await page.getByRole("button", { name: "Reload Chibako" }).click();
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole("button", { name: "Reload now" }).click(),
  ]);
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByRole("tab", { name: "Knowledge schema (AGENTS.md)" })).toBeVisible();
});

test("an unavailable updater status does not make an active request look unstarted", async ({ page }) => {
  await authenticate(page);
  for (const name of fs.readdirSync(path.join(updaterDir, "in"))) fs.rmSync(path.join(updaterDir, "in", name));
  publish(null);
  await page.clock.install({ time: new Date() });
  await page.reload();

  await page.getByRole("button", { name: "Update", exact: true }).click();
  await page.getByRole("button", { name: "Update now" }).click();
  await expect(page.getByText("Updating to v0.1.2")).toBeVisible();
  fs.rmSync(path.join(updaterDir, "out", "status.json"), { force: true });
  await page.clock.runFor(61_000);

  await expect(page.getByText("Updating to v0.1.2")).toBeVisible();
  await expect(page.getByText("Restarting Chibako")).toBeVisible();
  await expect(page.getByText("The updater did not start the update.")).toHaveCount(0);

  const operation = { id: "22222222-2222-4222-8222-222222222222", from: "0.1.1", to: "0.1.2", updatedAt: Date.now() };
  publish({ ...operation, phase: "snapshotting", error: null });
  await expect(page.getByText("Backing up your vault")).toBeVisible();
  publish({ ...operation, phase: "succeeded", error: null });
  await expect(page.getByText("Chibako 0.1.2 is installed.")).toBeVisible();
});

test("an observer tab offers a manual reload for a newer version without losing dirty settings", async ({ page }) => {
  await authenticate(page);
  for (const name of fs.readdirSync(path.join(updaterDir, "in"))) fs.rmSync(path.join(updaterDir, "in", name));
  let currentVersion = "0.1.1";
  let postCount = 0;
  await page.route("**/api/updates", async (route) => {
    if (route.request().method() !== "GET") {
      postCount++;
      await route.fulfill({ status: 500 });
      return;
    }
    await route.fulfill({ json: currentVersion === "0.1.1"
      ? {
          state: "available", currentVersion, latest: { version: "0.1.2", notes: "Faster search", publishedAt: "2026-10-21T00:00:00Z", url: "https://github.com/jccd-dev/chibako/releases/tag/v0.1.2" }, operation: null, message: null,
        }
      : { state: "current", currentVersion, latest: null, operation: null, message: null } });
  });
  await page.clock.install({ time: new Date() });
  await page.goto("/app/settings");
  const schema = page.getByRole("textbox").first();
  await expect(schema).toHaveValue(/# Chibako Vault Schema/);
  await schema.fill("Unsaved observer-tab fixture");

  currentVersion = "0.1.2";
  await page.clock.runFor(15_000);
  await expect(page.getByText("Chibako 0.1.2 is installed.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(schema).toHaveValue("Unsaved observer-tab fixture");
  await expect(page.getByRole("button", { name: "Reload Chibako" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload now" })).toHaveCount(0);
  expect(postCount).toBe(0);
  expect(fs.readdirSync(path.join(updaterDir, "in"))).toHaveLength(0);
});

test("settings explains an unavailable updater instead of offering a broken update", async ({ page }) => {
  await authenticate(page);
  fs.rmSync(path.join(updaterDir, "out", "status.json"), { force: true });
  await page.goto("/app/settings");
  await page.getByRole("tab", { name: "Updates" }).click();
  await expect(page.getByText("The Chibako updater is not responding.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).not.toHaveAttribute("aria-describedby");
  await expect(page.getByRole("button", { name: /Update to/ })).toHaveCount(0);
});

test("needs-attention state blocks update actions in the notice and settings", async ({ page }) => {
  await authenticate(page);
  for (const name of fs.readdirSync(path.join(updaterDir, "in"))) fs.rmSync(path.join(updaterDir, "in", name));
  publish({
    id: "11111111-1111-4111-8111-111111111111",
    from: "0.1.1",
    to: "0.1.2",
    updatedAt: Date.now(),
    phase: "needs_attention",
    error: "Manual recovery is required.",
  });
  await page.reload();

  await expect(page.getByRole("alert").filter({ hasText: "The last update needs attention" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).not.toHaveAttribute("aria-describedby");

  await page.goto("/app/settings");
  await page.getByRole("tab", { name: "Updates" }).click();
  await expect(page.getByRole("button", { name: "Update to v0.1.2" })).toBeDisabled();
  expect(fs.readdirSync(path.join(updaterDir, "in"))).toHaveLength(0);
});
