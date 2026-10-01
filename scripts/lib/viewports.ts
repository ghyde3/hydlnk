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
} as const;

export const DESKTOP = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
} as const;
