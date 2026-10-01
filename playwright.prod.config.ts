import { defineConfig } from "@playwright/test";
import { DESKTOP, PHONE } from "./scripts/lib/viewports";

/**
 * Production smoke config: same two projects as playwright.config.ts, but no webServer and no
 * baseURL, because every test names its own https://*.hydlnk.com URL.
 * Read-only checks against production. Run with: pnpm test:e2e:prod
 */
export default defineConfig({
  testDir: "tests/e2e-prod",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone", use: { browserName: "chromium", ...PHONE } },
    { name: "desktop", use: { browserName: "chromium", ...DESKTOP } },
  ],
});
