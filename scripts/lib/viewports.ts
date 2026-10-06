/**
 * The two viewports every HYDLNK check runs at. Shared by playwright.config.ts,
 * playwright.prod.config.ts and scripts/screens.ts so they cannot drift apart.
 * Spread into Playwright `use` / `browser.newContext()` options.
 */
export const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  // A normal Android Chrome user agent: the analytics ingest drops HeadlessChrome as a bot.
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
} as const;

export const DESKTOP = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  // A normal desktop Chrome user agent: the analytics ingest drops HeadlessChrome as a bot.
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
} as const;
