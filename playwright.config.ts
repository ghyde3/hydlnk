import { defineConfig } from "@playwright/test";
import { DESKTOP, PHONE } from "./scripts/lib/viewports";

/**
 * Local end-to-end config. Two projects, phone (390x844) and desktop (1440x900), both Chromium.
 * Tenant hosts are `*.localhost`, which Chromium resolves to loopback itself, so no /etc/hosts
 * entries are needed. Run the smoke subset with: pnpm test:e2e --grep @smoke
 */
export default defineConfig({
  testDir: "tests/e2e",
  // Dev mode compiles routes on demand; the first hit of a route can take several seconds.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone", use: { browserName: "chromium", ...PHONE } },
    { name: "desktop", use: { browserName: "chromium", ...DESKTOP } },
  ],
  webServer: [
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // The stand-in for the Vercel domains API (VERCEL_API_BASE_URL in .env.local): deleting a page
      // or an account removes its custom domains through it. The Stripe stub starts on demand.
      command:
        "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/e2e/fixtures/vercel-stub-server.ts 12112",
      url: "http://127.0.0.1:12112/__stub/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
