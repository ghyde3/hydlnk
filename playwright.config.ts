import { defineConfig } from "@playwright/test";
import { e2eWebServer } from "./scripts/lib/e2e-server";
import { DESKTOP, PHONE } from "./scripts/lib/viewports";

/**
 * Port of the server under test (the dev server, or `next start` in CI). 3000 unless HL_DEV_PORT
 * says otherwise, so a second checkout (a git worktree with its own `PORT=3200 pnpm dev` and
 * NEXT_PUBLIC_ROOT_DOMAIN=localhost:3200) can run its specs without touching the main dev server:
 * HL_DEV_PORT=3200 pnpm test:e2e ...
 * tests/e2e/helpers.ts and scripts/screens.ts read the same variable.
 */
const DEV_PORT = Number(process.env.HL_DEV_PORT ?? 3000);

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
    baseURL: `http://localhost:${DEV_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone", use: { browserName: "chromium", ...PHONE } },
    { name: "desktop", use: { browserName: "chromium", ...DESKTOP } },
  ],
  webServer: [
    // The app under test. `pnpm dev` (the shared dev server, reused when it already answers) unless
    // CI sets HL_E2E_SERVER=start: then the job's production build, `next start`, on a fresh port
    // (M9-13, scripts/lib/e2e-server.ts).
    e2eWebServer(DEV_PORT, process.env),
    {
      // The stand-in for the Vercel domains API (VERCEL_API_BASE_URL in .env.local): deleting a page
      // or an account removes its custom domains through it. The Stripe stub starts on demand.
      // Its port is fixed, so a second checkout (HL_DEV_PORT) shares it.
      command:
        "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/e2e/fixtures/vercel-stub-server.ts 12112",
      url: "http://127.0.0.1:12112/__stub/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
