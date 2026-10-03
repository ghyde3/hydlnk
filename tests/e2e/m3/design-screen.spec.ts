import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { MARA_EMAIL, pageRow, seededUser } from "../m2/editor-helpers";
import { signInAs } from "../fixtures/auth";
import {
  DESIGN_URL,
  computed,
  expectOverrides,
  openDesign,
  previewRoot,
  saveStatus,
  showPreview,
  tokenVars,
} from "./design-helpers";

/**
 * M3-06: the Design screen frame, the live preview and the Tokens | Preview tabs on a phone.
 * One smoke per viewport (the bar for non-security screens), plus the signed-out redirect.
 */

test.afterAll(cleanupUsers);

test.describe("M3-06 Design screen", () => {
  test("M3-06 signed out, /design redirects to sign-in", async ({ page }) => {
    await page.goto(DESIGN_URL);
    await expect(page).toHaveURL(/\/login/);
  });

  test("M3-06 desktop: header, two columns, the preview matches the public page, Done goes to the editor", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await seededUser(context, "dsg1");
    await openDesign(page);

    // Sidebar item, breadcrumb, title, header buttons.
    await expect(page.getByRole("link", { name: "Design" }).first()).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("header p").first()).toHaveText(/^Theme · Noir/);
    const h1 = page.getByRole("heading", { level: 1, name: "Design" });
    expect(await h1.evaluate((el) => getComputedStyle(el).fontSize)).toBe("22px");
    expect(await h1.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("700");
    await expect(page.getByRole("button", { name: "Save as theme" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Done" })).toBeVisible();

    // Two columns: token sections (max 720px) and the live preview with a 310x660 bezel.
    const tokens = page.getByRole("region", { name: "Style settings" });
    await expect(tokens).toBeVisible();
    expect((await tokens.boundingBox())!.width).toBeLessThanOrEqual(720);
    const preview = page.getByRole("region", { name: "Live preview" });
    await expect(preview).toBeVisible();
    await expect(preview.getByText("A block’s own style still wins")).toBeVisible();
    const bezel = await page.getByTestId("preview-bezel").boundingBox();
    expect(Math.round(bezel!.width)).toBe(310);
    expect(Math.round(bezel!.height)).toBe(660);
    await expect(page.getByRole("tablist", { name: "Design view" })).toHaveCount(0);

    // The preview renders the page's real blocks through PageRenderer: same --t-* values as live.
    await expect(previewRoot(page).locator("[data-block-type='link']").first()).toBeVisible();
    const live = await page.context().newPage();
    await live.goto(url(user.handle));
    const publicVars = await tokenVars(live.locator("[data-page-root]"));
    const previewVars = await tokenVars(previewRoot(page));
    expect(Object.keys(previewVars).length).toBeGreaterThanOrEqual(23);
    expect(previewVars).toEqual(publicVars);
    await live.close();

    await expectNoHorizontalScroll(page);

    // Done leads to the editor.
    await page.getByRole("link", { name: "Done" }).click();
    await expect(page).toHaveURL(url("app", "/editor"));
  });

  test("M3-06 phone: top bar, tab bar, Tokens | Preview tabs, no horizontal scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dsg2");
    await openDesign(page);

    // Sidebar hidden; the tab bar shows Design active.
    await expect(page.locator("aside")).toBeHidden();
    const bar = page.getByRole("navigation", { name: "App sections" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "Design" })).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "header, [role=tablist], nav[aria-label='App sections']");

    // Tokens is selected by default; the preview pane is hidden.
    const tablist = page.getByRole("tablist", { name: "Design view" });
    await expect(tablist).toBeVisible();
    const tokensTab = tablist.getByRole("tab", { name: "Style" });
    const previewTab = tablist.getByRole("tab", { name: "Preview" });
    await expect(tokensTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Accent Brass" })).toBeVisible();
    await expect(page.getByTestId("preview-screen")).toBeHidden();
    for (const tab of [tokensTab, previewTab]) {
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Keyboard: ArrowRight selects Preview and moves focus; the preview is full width, no bezel.
    await tokensTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(previewTab).toHaveAttribute("aria-selected", "true");
    await expect(previewTab).toBeFocused();
    await expect(page.getByRole("button", { name: "Accent Brass" })).toBeHidden();
    const screen = page.getByTestId("preview-screen");
    await expect(screen).toBeVisible();
    expect(Math.round((await screen.boundingBox())!.width)).toBe(390 - 32);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("ArrowLeft");
    await expect(tokensTab).toHaveAttribute("aria-selected", "true");

    // Focus ring: 2px brass outline.
    const outline = await tokensTab.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, color: s.outlineColor };
    });
    expect(outline.width).toBe("2px");
  });

  test("M3-06 radius 20 chosen on the Tokens tab shows as a 20px radius on the preview's link buttons", async ({
    page,
    context,
  }) => {
    await seededUser(context, "dsg4");
    await openDesign(page);
    await page
      .getByRole("group", { name: "Corner radius" })
      .getByRole("button", { name: "20px", exact: true })
      .click();
    await showPreview(page);
    const link = previewRoot(page).locator(".pg-link").first();
    await expect
      .poll(() => link.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))
      .toBe("20px");
  });

  test("M3-06 the saved-themes card and Save as theme are wired to the screen's draft: applying Ivory updates the header and preview and autosaves", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dsg6");
    await openDesign(page);
    await expect(page.getByTestId("saved-themes-card")).toBeVisible();
    await expect(page.getByTestId("save-as-theme")).toBeVisible();
    await expect(page.locator("header p").first()).toHaveText(/^Theme · Noir/);

    await page.getByTestId("theme-card").filter({ hasText: "Ivory" }).click();
    await expect(page.locator("header p").first()).toHaveText("Theme · Ivory");
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expectOverrides(user.pageId, (o) => Object.keys(o).length === 0);
    const row = await pageRow(user.pageId);
    expect(row.draft.theme.ref).toBe("00000000-0000-4000-8000-000000000002");
    await showPreview(page);
    expect(await computed(previewRoot(page), "--t-bg")).not.toBe("#16120E");
  });

  test("M3-06 phone: Enter on a focused tab selects it", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dsg5");
    await openDesign(page);
    const tablist = page.getByRole("tablist", { name: "Design view" });
    const previewTab = tablist.getByRole("tab", { name: "Preview" });
    await previewTab.focus();
    await page.keyboard.press("Enter");
    await expect(previewTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("preview-screen")).toBeVisible();
  });

  test("M3-06 the tablist appears at 759px and is gone at 761px", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "resizes the viewport itself");
    await seededUser(context, "dsg3");
    await page.setViewportSize({ width: 759, height: 900 });
    await openDesign(page);
    await expect(page.getByRole("tablist", { name: "Design view" })).toBeVisible();
    await page.setViewportSize({ width: 761, height: 900 });
    await expect(page.getByRole("tablist", { name: "Design view" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Live preview" })).toBeVisible();
  });

  test("M3-06 mara's Design screen reads, never writes", async ({ page, context }) => {
    await signInAs(context, MARA_EMAIL);
    await openDesign(page);
    await expect(page.locator("header p").first()).toHaveText(/^Theme · /);
    await showPreview(page);
    await expect(previewRoot(page)).toBeVisible();
  });
});
