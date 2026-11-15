import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page) {
  await page.setExtraHTTPHeaders({ "x-chibako-client-ip": `pwa-e2e-${randomUUID()}` });
  await page.goto("/");
  if (/\/setup$/.test(page.url())) {
    await page.getByLabel("Setup token", { exact: true }).fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
    await page.getByLabel("Admin password", { exact: true }).fill("correct horse battery staple");
    await page.getByLabel("Confirm password", { exact: true }).fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
  } else if (/\/login$/.test(page.url())) {
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
}

async function openInstallPanel(page: Page) {
  await page.getByRole("link", { name: "Settings", exact: true }).press("Enter");
  await page.getByRole("tab", { name: "Install app", exact: true }).click();
}

async function offerInstall(page: Page, outcome: "accepted" | "dismissed", fail = false) {
  await expect.poll(() => page.evaluate(({ outcome, fail }) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        const root = document.documentElement;
        root.dataset.installPromptCalls = String(Number(root.dataset.installPromptCalls ?? 0) + 1);
        if (fail) throw new Error("Browser refused the prompt");
      },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, { outcome, fail })).toBe(true);
}

test("installation metadata and icons are public and the launch URL uses existing authentication", async ({ page, request }) => {
  const response = await request.get("/site.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "Chibako", id: "/", start_url: "/", scope: "/", display: "standalone" });
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry: { sizes: string }) => entry.sizes === `${size}x${size}`);
    expect(icon).toBeDefined();
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
    const png = await image.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
  }
  await page.goto(manifest.start_url);
  await expect(page).toHaveURL(/\/(setup|login)$/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/site.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/favicon_io/apple-touch-icon.png");
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Chibako");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#19191a");
});

test("a prompt received on Home survives navigation and installation preserves unsaved settings", async ({ page }) => {
  await authenticate(page);
  await offerInstall(page, "accepted");
  await page.getByRole("link", { name: "Settings", exact: true }).press("Enter");
  const draft = page.locator("textarea.font-mono");
  await expect(draft).not.toHaveValue("");
  await draft.fill("PWA unsaved settings fixture");
  await page.getByRole("tab", { name: "Install app", exact: true }).click();
  const install = page.getByRole("button", { name: "Install Chibako", exact: true });
  await expect(install).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-install-prompt-calls");
  await install.click();
  await expect(page.getByRole("status")).toContainText("Installation requested.");
  await expect(install).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-install-prompt-calls", "1");
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByRole("status")).toContainText("Chibako was installed.");
  await expect(page.getByRole("heading", { name: "Install from your browser" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Knowledge schema (AGENTS.md)", exact: true }).click();
  await expect(draft).toHaveValue("PWA unsaved settings fixture");
});

test("dismissal consumes the prompt and a new browser event allows another attempt", async ({ page }) => {
  await authenticate(page);
  await offerInstall(page, "dismissed");
  await openInstallPanel(page);
  const install = page.getByRole("button", { name: "Install Chibako", exact: true });
  await install.click();
  await expect(page.getByRole("status")).toContainText("Installation dismissed.");
  await expect(install).toHaveCount(0);
  await offerInstall(page, "accepted");
  await install.click();
  await expect(page.getByRole("status")).toContainText("Installation requested.");
  await expect(page.locator("html")).toHaveAttribute("data-install-prompt-calls", "2");
});

test("a failed install prompt shows recovery instructions without reusing the event", async ({ page }) => {
  await authenticate(page);
  await offerInstall(page, "accepted", true);
  await openInstallPanel(page);
  const install = page.getByRole("button", { name: "Install Chibako", exact: true });
  await install.click();
  await expect(page.getByRole("tabpanel", { name: "Install app" }).getByRole("alert")).toContainText("Could not open installation. Try your browser's Install app menu.");
  await expect(install).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Install from your browser" })).toBeVisible();
});

test("without a prompt Settings explains browser installation and fits narrow screens", async ({ page }) => {
  await authenticate(page);
  await openInstallPanel(page);
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#eff1ed");
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#19191a");
  await expect(page.getByRole("button", { name: "Install Chibako", exact: true })).toHaveCount(0);
  await expect(page.getByText("Requires a connection to your Chibako server. Offline mode is not available yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Install from your browser" })).toBeVisible();
  await expect(page.getByRole("status")).toBeEmpty();
  for (const width of [1280, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText(/Installation requires HTTPS/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`install-${width}.png`), fullPage: true, animations: "disabled" });
  }
});

for (const device of ["iPhone", "desktop-mode iPad"]) {
  test(`${device} receives Safari home-screen instructions`, async ({ page }) => {
    await page.addInitScript((device) => {
      if (device === "iPhone") {
        Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
      } else {
        Object.defineProperty(navigator, "platform", { value: "MacIntel" });
        Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
      }
    }, device);
    await authenticate(page);
    await openInstallPanel(page);
    await expect(page.getByRole("heading", { name: "On iPhone or iPad" })).toBeVisible();
    await expect(page.getByText(/tap Share, then Add to Home Screen/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Install Chibako", exact: true })).toHaveCount(0);
  });
}

for (const mode of ["display-mode", "Safari standalone"]) {
  test(`${mode} hides installation controls in the installed app`, async ({ page }) => {
    await page.addInitScript((mode) => {
      if (mode === "Safari standalone") {
        Object.defineProperty(navigator, "standalone", { value: true });
      } else {
        const matchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = matchMedia(query);
          if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", { value: true });
          return result;
        };
      }
    }, mode);
    await authenticate(page);
    await offerInstall(page, "accepted");
    await openInstallPanel(page);
    await expect(page.getByRole("status")).toContainText("You’re using the installed app.");
    await expect(page.getByRole("button", { name: "Install Chibako", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Install from your browser" })).toHaveCount(0);
    await page.request.post("/api/logout");
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
}
