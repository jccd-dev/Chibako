import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CHIBAKO_SETUP_TOKEN = "e2e-only-setup-token-at-least-32-characters";

const port = 3100;
const dataDir = process.env.CHIBAKO_E2E_DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "chibako-e2e-"));
process.env.CHIBAKO_E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CHIBAKO_SETUP_TOKEN: process.env.CHIBAKO_SETUP_TOKEN, CHIBAKO_TRUST_PROXY: "true", CHIBAKO_DATA_DIR: dataDir, CHIBAKO_BUILD_DIR: ".next/test-builds/browser-auth" },
  },
});
