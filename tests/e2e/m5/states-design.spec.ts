import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { mark, pageRow, seededUser, setDraft } from "../m2/editor-helpers";
import {
  expectOverrides,
  openDesign,
  previewScreen,
  saveStatus,
  showPreview,
  showTokens,
} from "../m3/design-helpers";

/**
 * M5-16: the Design screen's empty and error states. Phone project = 390x844, desktop = 1440x900.
 * Every spec makes its own user (nothing here touches mara's rows).
 *
 * Both reads on this screen are made by the Next.js server, which a Playwright route cannot abort.
 * They are switched off with the `hl-fault` cookie (src/lib/testing/faults.ts: dev server only, and
 * those specs skip themselves against a production build). The Retry on the themes row reads from
 * the browser, so there the acceptance's own mechanism applies: the themes request is aborted.
 */

test.afterAll(cleanupUsers);

const PROD_BUILD = process.env.E2E_PROD_BUILD === "1" || Boolean(process.env.HL_PROD_PORT);
const THEMES_FAILED = "We couldn’t load your themes. Try again.";
const HINT = "Saved themes appear here. Use Save as theme to reuse this design on any page.";
const DELETED = "The theme this page used was deleted. It now uses the default theme.";
const SIGNED_OUT = "You’ve been signed out. Sign in to keep editing.";
const SAVE_FAILED = "Couldn’t save. Your changes stay here and will retry.";

const setFault = (context: BrowserContext, name: string) =>
  context.addCookies([{ name: "hl-fault", value: name, url: url("app") }]);
const clearFault = (context: BrowserContext) => context.clearCookies({ name: "hl-fault" });

const card = (page: Page) => page.getByTestId("saved-themes-card");

/**
 * Every tappable thing at least 44px: the whole screen on the phone (DESIGN.md's floor), and on
 * desktop the parts this feature owns (the Design screen's own token buttons are 40px there).
 */
async function expectTargets(page: Page, ...owned: string[]): Promise<void> {
  if (phoneOnly(test.info())) await expectTapTargets(page);
  else await expectTapTargets(page, owned.join(", ") || undefined);
}
const OWNED = ['[data-testid="saved-themes-card"]', "[data-save-problem]", '[data-testid="load-failure"]', '[data-testid="theme-deleted-notice"]'];

/** The tenant tokens a page's HTML carries (`--t-radius:12px` ...): what "unchanged" means for a live page. */
const tokensOf = (html: string): string[] => html.match(/--t-[a-z-]+:[^;"}]+/g) ?? [];
const radius = (page: Page, value: number) =>
  page
    .getByRole("group", { name: "Corner radius" })
    .getByRole("button", { name: `${value}px`, exact: true });

test.describe("M5-16 no saved themes yet", () => {
  test("M5-16 the row shows the system themes and the hint, and no saved-theme controls", async ({
    page,
    context,
  }) => {
    await seededUser(context, "d16a");
    await openDesign(page);
    await showTokens(page);
    await expect(card(page).getByTestId("saved-themes-hint")).toHaveText(HINT);
    const cards = card(page).getByTestId("theme-card");
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    // Only system themes: none has Rename or Delete.
    await expect(card(page).getByRole("button", { name: /^Rename/ })).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: /^Delete/ })).toHaveCount(0);
    await expect(card(page).getByTestId("themes-load-error")).toHaveCount(0);
  });

  test("M5-16 once a theme is saved the hint goes", async ({ page, context }) => {
    await seededUser(context, "d16b");
    await openDesign(page);
    await showTokens(page);
    await expect(card(page).getByTestId("saved-themes-hint")).toBeVisible();
    await page.getByRole("button", { name: "Save as theme" }).click();
    await expect(card(page).getByText(/^Saved as /)).toBeVisible();
    await expect(card(page).getByTestId("saved-themes-hint")).toHaveCount(0);
  });

  test("M5-16 at 390 and 1440 the empty state has no sideways scroll and 44px targets", async ({
    page,
    context,
  }) => {
    await seededUser(context, "d16c");
    await openDesign(page);
    await showTokens(page);
    await expect(card(page).getByTestId("saved-themes-hint")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTargets(page, ...OWNED);
  });
});

test.describe("M5-16 the themes cannot be loaded", () => {
  test.skip(PROD_BUILD, "the fault cookie is honoured by the dev server only");

  test("M5-16 the row says so with Retry while the token controls and the preview stay usable; Retry (aborted, then not) loads them", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "d16d");
    await setFault(context, "themes-load");
    await openDesign(page);
    await showTokens(page);

    const error = card(page).getByTestId("themes-load-error");
    await expect(error).toContainText(THEMES_FAILED);
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    // No grid and no hint while the list is unknown; nothing of the failure's own text.
    await expect(card(page).getByTestId("theme-card")).toHaveCount(0);
    await expect(card(page).getByTestId("saved-themes-hint")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/Injected fault|digest|stack/i);

    // The token controls work and autosave: a radius edit lands in the draft.
    await radius(page, 20).click();
    await expect(radius(page, 20)).toHaveAttribute("aria-pressed", "true");
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 15_000 });
    await expectOverrides(user.pageId, (o) => o.radius === 20);
    // And the preview follows (the page resolves from the default theme plus its own overrides).
    await showPreview(page);
    await expect(previewScreen(page)).toBeVisible();
    await showTokens(page);

    // Retry with the themes request aborted: still the message, the screen is still there.
    let aborted = 0;
    await page.route("**/rest/v1/themes**", async (route) => {
      aborted += 1;
      await route.abort("connectionreset");
    });
    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => aborted).toBeGreaterThan(0);
    await expect(error).toContainText(THEMES_FAILED);
    await expect(error.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
    await expect(radius(page, 20)).toHaveAttribute("aria-pressed", "true");

    // Abort lifted: Retry loads the themes in place, without a reload (the edit is still there).
    await page.unroute("**/rest/v1/themes**");
    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(card(page).getByTestId("theme-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(error).toHaveCount(0);
    await expect(card(page).getByTestId("saved-themes-hint")).toHaveText(HINT);
    await expect(radius(page, 20)).toHaveAttribute("aria-pressed", "true");
    // The page's own theme (Noir) is applied again once the list is known.
    await expect(page.locator("header p").first()).toHaveText(/^Theme · Noir/);
  });

  test("M5-16 a draft that cannot be read: the screen's header and a load-failure card with Retry", async ({
    page,
    context,
  }) => {
    await seededUser(context, "d16e");
    await setFault(context, "draft-load");
    await page.goto(url("app", "/design"));
    await expect(page.getByTestId("load-failure")).toHaveText(
      "We couldn’t load your page. Try again.",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Design");
    await expectNoHorizontalScroll(page);
    await expectTargets(page, ...OWNED);
    await clearFault(context);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
  });

  test("M5-16 the themes row failure: no sideways scroll, 44px targets, the Tokens | Preview control works", async ({
    page,
    context,
  }) => {
    await seededUser(context, "d16f");
    await setFault(context, "themes-load");
    await openDesign(page);
    await showTokens(page);
    const error = card(page).getByTestId("themes-load-error");
    await expect(error).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTargets(page, ...OWNED);
    expect(await error.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(178, 58, 43)");
    expect(await error.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
      "rgb(232, 196, 189)",
    );
    if (phoneOnly(test.info())) {
      await page.getByRole("tab", { name: "Preview" }).click();
      await expect(previewScreen(page)).toBeVisible();
      await page.getByRole("tab", { name: "Style" }).click();
      await expect(error).toBeVisible();
    }
    if (desktopOnly(test.info())) {
      // Side by side: the token column and the preview are both on screen.
      await expect(previewScreen(page)).toBeVisible();
      await expect(error).toBeVisible();
    }
  });
});

test.describe("M5-16 the theme this page used was deleted", () => {
  async function pageWithSavedTheme(context: BrowserContext, label: string) {
    const user = await seededUser(context, label);
    const admin = adminClient();
    const tokens = {
      ...((await admin.from("themes").select("tokens").eq("id", NOIR).single()).data!
        .tokens as object),
    };
    const theme = await admin
      .from("themes")
      .insert({ owner_id: user.userId, name: "Gone soon", tokens })
      .select("id")
      .single();
    expect(theme.error).toBeNull();
    const id = theme.data!.id as string;
    const draft = (await pageRow(user.pageId)).draft;
    await setDraft(user.pageId, { ...draft, theme: { ref: id, overrides: {} } });
    return { user, themeId: id };
  }
  const NOIR = "00000000-0000-4000-8000-000000000001";

  test("M5-16 Design says so, the chip shows the default, nothing is written and the live page is unchanged", async ({
    page,
    context,
  }) => {
    const { user, themeId } = await pageWithSavedTheme(context, "d16g");
    // Before: the theme is there and applied, no notice.
    await openDesign(page);
    await expect(page.locator("header p").first()).toHaveText("Theme · Gone soon");
    await expect(page.getByTestId("theme-deleted-notice")).toHaveCount(0);

    const before = await pageRow(user.pageId);
    const liveBefore = await rawRequest(`${user.handle}.localhost:3000`, "/");
    // Deleted with the secret key: the draft keeps pointing at it.
    const gone = await adminClient().from("themes").delete().eq("id", themeId);
    expect(gone.error).toBeNull();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Design" })).toBeVisible();
    await showTokens(page);
    const notice = page.getByTestId("theme-deleted-notice");
    await expect(notice).toHaveText(DELETED);
    await expect(notice).toHaveAttribute("role", "status");
    await expect(page.locator("header p").first()).toHaveText("Theme · Default");
    // No theme card claims to be applied.
    await expect(card(page).getByText("Applied", { exact: true })).toHaveCount(0);

    // The screen wrote nothing by itself: same draft and revision, same published document.
    await page.waitForTimeout(2_000);
    const after = await pageRow(user.pageId);
    expect(after.draft).toEqual(before.draft);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
    const liveAfter = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(liveAfter.status).toBe(200);
    expect(tokensOf(liveAfter.body)).toEqual(tokensOf(liveBefore.body));
    expect(tokensOf(liveBefore.body).length).toBeGreaterThan(5);
  });

  test("M5-16 picking a theme replaces the dangling reference and the notice goes", async ({
    page,
    context,
  }) => {
    const { user, themeId } = await pageWithSavedTheme(context, "d16h");
    await adminClient().from("themes").delete().eq("id", themeId);
    await openDesign(page);
    await showTokens(page);
    await expect(page.getByTestId("theme-deleted-notice")).toHaveText(DELETED);
    await card(page).getByTestId("theme-card").first().click();
    await expect(page.getByTestId("theme-deleted-notice")).toHaveCount(0);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 15_000 });
    const draft = (await pageRow(user.pageId)).draft;
    expect(draft.theme.ref).not.toBe(themeId);
    expect(draft.theme.ref).not.toBeNull();
  });

  test("M5-16 the notice at 390 and 1440: no sideways scroll, 44px targets", async ({
    page,
    context,
  }) => {
    const { themeId } = await pageWithSavedTheme(context, "d16i");
    await adminClient().from("themes").delete().eq("id", themeId);
    await openDesign(page);
    await showTokens(page);
    await expect(page.getByTestId("theme-deleted-notice")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTargets(page, ...OWNED);
  });
});

test.describe("M5-16 the Editor's save banners also appear on Design, and the edit stays on screen", () => {
  test("M5-16 offline: Not saved with the retry message, the edit stays, saved once back online", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "d16j");
    await openDesign(page);
    await showTokens(page);
    await context.setOffline(true);
    await radius(page, 4).click();
    await expect(saveStatus(page)).toHaveText("Not saved", { timeout: 15_000 });
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    await expect(radius(page, 4)).toHaveAttribute("aria-pressed", "true");
    await context.setOffline(false);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });
    await expect(page.getByText(SAVE_FAILED)).toHaveCount(0);
    await expectOverrides(user.pageId, (o) => o.radius === 4);
  });

  test("M5-16 a 401: the signed-out banner with Sign in, no retry loop, the token edit stays", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "d16k");
    await openDesign(page);
    await showTokens(page);
    let patches = 0;
    let refusing = true;
    await page.route("**/rest/v1/pages**", async (route) => {
      if (route.request().method() === "PATCH" && refusing) {
        patches += 1;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ code: "PGRST301", message: "JWT expired" }),
        });
        return;
      }
      await route.continue();
    });
    await radius(page, 20).click();
    const banner = page.locator('[data-save-problem="signed-out"]');
    await expect(banner).toContainText(SIGNED_OUT, { timeout: 15_000 });
    await expect(banner.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await expect(saveStatus(page)).toHaveText("Not saved");
    await page.waitForTimeout(4_500);
    expect(patches).toBe(1);
    await expect(radius(page, 20)).toHaveAttribute("aria-pressed", "true");
    expect((await pageRow(user.pageId)).draft.theme.overrides).toEqual({});

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-save-problem]");
    if (phoneOnly(test.info())) {
      // The banner is in the flow, above the fixed tab bar; the Tokens | Preview control still works.
      const bar = (await page.getByRole("navigation", { name: "App sections" }).boundingBox())!;
      const box = (await banner.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      await showPreview(page);
      await expect(previewScreen(page)).toBeVisible();
      await showTokens(page);
    }

    // Back (signed in elsewhere): the tab is visible again, the edit is stored.
    refusing = false;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });
    await expect(banner).toHaveCount(0);
    await expectOverrides(user.pageId, (o) => o.radius === 20);
  });

  test("M5-16 Done with a signed-out session stays on Design instead of losing the edit", async ({
    page,
    context,
  }) => {
    await seededUser(context, "d16l");
    await openDesign(page);
    await showTokens(page);
    await page.route("**/rest/v1/pages**", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
        return;
      }
      await route.continue();
    });
    await radius(page, 20).click();
    await expect(page.locator('[data-save-problem="signed-out"]')).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "Done" }).click();
    // The flush fails, so Done does not navigate: the edit is still in front of the person.
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(url("app", "/design"));
    await expect(radius(page, 20)).toHaveAttribute("aria-pressed", "true");
    expect(mark()).toBeTruthy();
  });
});
