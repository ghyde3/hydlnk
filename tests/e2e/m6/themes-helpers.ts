import { expect, type Locator, type Page, type Request } from "@playwright/test";
import {
  headerStatus,
  isPhone,
  messageOf,
  savedThemesCard,
  themeCard,
  themeCards,
  themeUser,
  openDesignWithCard,
  previewRootOf,
  rootVars,
  expectNoHorizontalScroll,
  expectTapTargets,
  storedTheme,
  expectStoredTheme,
  seedTheme,
  NOIR,
  FILL_LINK,
  PLAIN_LINK,
  liveHtml,
} from "../m3/themes-helpers";
import { showPreview, showTokens } from "../m3/design-helpers";
import { pageRow } from "../m2/editor-helpers";

/**
 * Shared setup for the theme specs of Milestone 6 (M6-43 sixteen system themes, M6-44 previewing a
 * theme before applying it). Every spec makes its own user (themeUser: a signed-in user with a
 * copy of mara's published page); mara's rows are never touched.
 */

export const SYSTEM_IDS = {
  Noir: "00000000-0000-4000-8000-000000000001",
  Ivory: "00000000-0000-4000-8000-000000000002",
  Smoke: "00000000-0000-4000-8000-000000000003",
  Paper: "00000000-0000-4000-8000-000000000004",
  Sage: "00000000-0000-4000-8000-000000000005",
  Midnight: "00000000-0000-4000-8000-000000000006",
  Ember: "00000000-0000-4000-8000-000000000007",
  Linen: "00000000-0000-4000-8000-000000000008",
  Cloud: "00000000-0000-4000-8000-000000000009",
  Blush: "00000000-0000-4000-8000-000000000010",
  Citrus: "00000000-0000-4000-8000-000000000011",
  Graphite: "00000000-0000-4000-8000-000000000012",
  Ocean: "00000000-0000-4000-8000-000000000013",
  Plum: "00000000-0000-4000-8000-000000000014",
  Forest: "00000000-0000-4000-8000-000000000015",
  Sunset: "00000000-0000-4000-8000-000000000016",
} as const;

export const SYSTEM_NAMES = Object.keys(SYSTEM_IDS) as (keyof typeof SYSTEM_IDS)[];
export const NEW_THEME_NAMES = SYSTEM_NAMES.slice(7);

/** The Preview button of one card (M6-44). */
export const previewButton = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: `Preview ${name}`, exact: true });

export const applyPreviewButton = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: `Apply ${name}`, exact: true });

/** Every request that could write: the draft and themes tables, Storage, and server actions. */
export function trackWrites(page: Page): { requests: string[]; reset: () => void } {
  const requests: string[] = [];
  page.on("request", (request: Request) => {
    const method = request.method();
    const target = request.url();
    const writes =
      method === "PATCH" || method === "POST" || method === "PUT" || method === "DELETE";
    // Reading a picture from Storage (a theme's own background image) is not a Storage call that
    // changes anything: only a write counts.
    if (
      (writes && (target.includes("/rest/v1/pages") || target.includes("/rest/v1/themes"))) ||
      (writes && target.includes("/storage/v1/"))
    ) {
      requests.push(`${method} ${target}`);
    }
  });
  return { requests, reset: () => requests.splice(0) };
}

/** The family names a preview font stylesheet link asks Google Fonts for, in order. */
export async function previewFontFamilies(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator("link[data-preview-fonts]")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs, "one preview font stylesheet").toHaveLength(1);
  return new URL(hrefs[0]!).searchParams.getAll("family").map((family) => family.split(":")[0]!);
}

/** What the preview's page root draws as its background, and its `--t-*` custom properties. */
export async function previewLook(page: Page) {
  const root = previewRootOf(page);
  const vars = await rootVars(root);
  const bg = await root.evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.backgroundColor, image: style.backgroundImage };
  });
  return { vars, bg };
}

export {
  headerStatus,
  isPhone,
  messageOf,
  savedThemesCard,
  themeCard,
  themeCards,
  themeUser,
  openDesignWithCard,
  previewRootOf,
  rootVars,
  expectNoHorizontalScroll,
  expectTapTargets,
  storedTheme,
  expectStoredTheme,
  seedTheme,
  NOIR,
  FILL_LINK,
  PLAIN_LINK,
  liveHtml,
  showPreview,
  showTokens,
  pageRow,
};
