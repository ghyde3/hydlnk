import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";
import { adminClient } from "../fixtures/auth";
import { rand, signedInUser, type SignedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { pageRow, setDraft, waitForEditorHydrated } from "../m2/editor-helpers";
import { DESIGN_URL, openDesign } from "./design-helpers";

/**
 * Shared setup for the themes specs (M3-05, M3-17 .. M3-24). Every spec makes its own users (the
 * phone and desktop projects run at the same time on one database); mara's rows are only read.
 *
 * Wiring: the saved-themes card, the row chip, `PageTokensProvider` and the Publish alert's Dismiss
 * live in files the themes area does not own and were wired in by the Wave C integration step; the
 * specs assert them, so unwiring any of them fails a test instead of skipping it.
 */

export const NOIR = "00000000-0000-4000-8000-000000000001";
export const IVORY = "00000000-0000-4000-8000-000000000002";
export const SYSTEM_THEME_COUNT = 7;

/** mara's seeded blocks: a Fill link (with the override), a plain link and a card. */
export const FILL_LINK = "Bt5rJ1fGz6Os";
export const PLAIN_LINK = "Qw8vC2nKd4Ly";
export const CARD = "Lc6hP0yRe3Zi";

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

export const tokens = (over: Partial<TokenSet> = {}): TokenSet => ({
  ...SYSTEM_DEFAULT_TOKENS,
  ...over,
});

export interface ThemeFixture {
  id: string;
  name: string;
}

/** A saved theme through the secret key (test setup only). */
export async function seedTheme(
  ownerId: string,
  name: string,
  over: Partial<TokenSet> = {},
): Promise<ThemeFixture> {
  const { data, error } = await adminClient()
    .from("themes")
    .insert({ owner_id: ownerId, name, tokens: tokens(over) as never })
    .select("id, name")
    .single();
  if (error) throw new Error(`seedTheme(${name}) failed: ${error.message}`);
  return { id: data.id as string, name };
}

export async function themeRowsOf(ownerId: string) {
  const { data, error } = await adminClient()
    .from("themes")
    .select("id, name, owner_id, tokens, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`themeRowsOf failed: ${error.message}`);
  return data;
}

export async function themeRow(id: string) {
  const { data } = await adminClient()
    .from("themes")
    .select("id, name, owner_id, tokens")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Points the stored draft at a theme with page overrides (secret key, test setup only). */
export async function setTheme(
  pageId: string,
  ref: string | null,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const row = await pageRow(pageId);
  await setDraft(pageId, { ...row.draft, theme: { ref, overrides } });
}

/** A signed-in user with one published page (a copy of mara's), on `plan`. */
export async function themeUser(
  context: BrowserContext,
  label: string,
  plan: "free" | "pro" | "studio" = "pro",
): Promise<SignedInUser> {
  return signedInUser(context, { label, plan });
}

/**
 * A second page for the same user: a copy of mara's draft and published page under a new handle
 * (so its live page renders), secret key, test setup only.
 */
export async function secondPage(
  user: SignedInUser,
  handleLabel = "mp",
): Promise<{ pageId: string; handle: string }> {
  const admin = adminClient();
  const handle = `zq-${handleLabel}-${rand(5)}`;
  const mara = await admin.from("pages").select("draft, published").eq("handle", "mara").single();
  if (mara.error) throw new Error(`seed page missing: ${mara.error.message}`);
  const inserted = await admin
    .from("pages")
    .insert({
      owner_id: user.userId,
      handle,
      draft: mara.data.draft,
      published: mara.data.published,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(`second page failed: ${inserted.error.message}`);
  return { pageId: inserted.data.id as string, handle };
}

/** Makes `pageId` the page every app screen works on (the host-only `hl-page` cookie). */
export async function switchTo(context: BrowserContext, pageId: string): Promise<void> {
  await context.addCookies([{ name: "hl-page", value: pageId, url: url("app") }]);
}

/**
 * The live page's markup for a tenant handle (raw request, no browser cache), without `<script>`
 * elements: in `next dev` their flight ids vary in length from one request to the next, while
 * everything a visitor sees (the markup, the `--t-*` variables, the font links) is stable.
 */
export async function liveHtml(handle: string): Promise<string> {
  const { rawRequest } = await import("../fixtures/http");
  const response = await rawRequest(`${handle}.localhost:3000`, "/");
  expect(response.status).toBe(200);
  return response.body.replace(/<script\b[\s\S]*?<\/script>/g, "");
}

const publishButton = (page: Page): Locator =>
  page.locator("main > header").getByRole("button", { name: "Publish", exact: true });

export const statusChip = (page: Page): Locator => page.locator("[data-publish-status]");

/** Opens the editor of the current page. */
export async function openEditorPage(page: Page): Promise<void> {
  await page.goto(url("app", "/editor"));
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  await waitForEditorHydrated(page);
}

/**
 * Publishes the current draft from the editor and waits until it is done: the "Published." toast
 * is up and `pages.published_at` moved. (The chip alone is not enough: a page whose draft equals
 * its published form says "Published" before the click.)
 */
export async function publishFromEditor(page: Page): Promise<void> {
  await openEditorPage(page);
  const id = await currentPageId(page);
  const before = (await pageRow(id)).published_at;
  await publishButton(page).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(statusChip(page)).toHaveText("Published");
  await expect.poll(async () => (await pageRow(id)).published_at).not.toBe(before);
}

/** The id of the page the app screens work on: the live link in the editor names its handle. */
async function currentPageId(page: Page): Promise<string> {
  const cookie = (await page.context().cookies(url("app"))).find((c) => c.name === "hl-page");
  if (cookie) return cookie.value;
  const handle = (await page.locator("main > header p").first().textContent())!.split(".")[0]!;
  const { data, error } = await adminClient()
    .from("pages")
    .select("id")
    .eq("handle", handle)
    .single();
  if (error) throw new Error(`no page for ${handle}: ${error.message}`);
  return data.id as string;
}

/** The `--t-*` custom properties on a page root, by name without the prefix. */
export async function rootVars(root: Locator): Promise<Record<string, string>> {
  return root.evaluate((el) => {
    const out: Record<string, string> = {};
    const style = (el as HTMLElement).style;
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      if (name.startsWith("--t-")) out[name.slice(4)] = style.getPropertyValue(name).trim();
    }
    return out;
  });
}

export const previewRootOf = (page: Page): Locator =>
  page.getByTestId("preview-screen").locator("[data-page-root]");

// -------------------------------------------------------------------------------------------
// The Design screen
// -------------------------------------------------------------------------------------------

export const savedThemesCard = (page: Page): Locator => page.getByTestId("saved-themes-card");
export const themeCards = (page: Page): Locator => savedThemesCard(page).getByTestId("theme-card");
export const themeCard = (page: Page, name: string): Locator =>
  savedThemesCard(page).locator(`li[data-theme-id] [data-testid="theme-card"]`, {
    has: page.locator("[data-theme-name]", { hasText: new RegExp(`^${escapeRe(name)}$`) }),
  });
export const messageOf = (page: Page): Locator =>
  savedThemesCard(page).getByTestId("theme-message");
export const headerStatus = (page: Page): Locator => page.locator("main > header p").first();

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Opens the Design screen and waits for the saved-themes card. The card is wired into the screen,
 * so a missing card is a failure, not a skip.
 */
export async function openDesignWithCard(page: Page): Promise<void> {
  await openDesign(page);
  await expect(savedThemesCard(page)).toBeVisible();
}

/** The draft's theme as stored. */
export async function storedTheme(pageId: string) {
  const row = await pageRow(pageId);
  return row.draft.theme as { ref: string | null; overrides: Record<string, unknown> };
}

export async function expectStoredTheme(
  pageId: string,
  check: (theme: { ref: string | null; overrides: Record<string, unknown> }) => unknown,
  message = "the stored draft theme",
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return Boolean(check(await storedTheme(pageId)));
        } catch {
          return false;
        }
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
}

/** Layout checks every themes surface shares. */
export async function expectFits(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
}

export { expectNoHorizontalScroll, expectTapTargets, url, DESIGN_URL, waitForEditorHydrated };
