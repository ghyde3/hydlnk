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
 * M3-06: the Design screen frame (since M7-02 the Design tab of the workspace) and its live
 * preview. One smoke per viewport (the bar for non-security screens), plus the signed-out redirect.
 */

test.afterAll(cleanupUsers);

test.describe("M3-06 Design screen", () => {
  test("M3-06 signed out, /design redirects to sign-in", async ({ page }) => {
    await page.goto(DESIGN_URL);
    await expect(page).toHaveURL(/\/login/);
  });

  test("M3-06 desktop: the Design tab of the workspace, two columns, the preview matches the public page, no Done button", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await seededUser(context, "dsg1");
    await openDesign(page);

    // M7-02: Design is a tab of the one workspace. The sidebar's Editor item is current, the Design
    // tab is selected, and the h1 is the page's name; there is no Done button (Publish is in the
    // toolbar) and no screen header of its own.
    await expect(
      page
        .getByRole("navigation", { name: "App", exact: true })
        .getByRole("link", { name: "Editor" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("tab", { name: "Design", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("h1:not([data-page-frame] *)")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Done" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);

    // Two columns: token sections (max 720px) and the live preview with a 310x660 bezel.
    const tokens = page.getByRole("tabpanel");
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
  });

  test("M3-06 phone: top bar, tab bar, the workspace tabs, no Style | Preview tabs, no horizontal scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "dsg2");
    await openDesign(page);

    // Sidebar hidden; the tab bar shows Editor active (Design is a tab of it).
    await expect(page.locator("aside")).toBeHidden();
    const bar = page.getByRole("navigation", { name: "App sections" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "Editor" })).toHaveAttribute("aria-current", "page");
    await expect(bar.getByRole("link", { name: "Design" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[role=tablist], nav[aria-label='App sections']");

    // The workspace tabs replace the old Style | Preview tabs: the controls are always shown.
    const tablist = page.getByRole("tablist", { name: "Workspace" });
    await expect(tablist).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Design view" })).toHaveCount(0);
    await expect(tablist.getByRole("tab", { name: "Design" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("button", { name: "Accent Brass" })).toBeVisible();
    for (const tab of await tablist.getByRole("tab").all()) {
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Focus ring: 2px brass outline.
    await tablist.getByRole("tab", { name: "Design" }).focus();
    const outline = await tablist.getByRole("tab", { name: "Design" }).evaluate((el) => {
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

  test("M3-06 the saved-themes card and Save as theme are wired to the workspace's draft: applying Ivory updates the chip and preview and autosaves", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dsg6");
    await openDesign(page);
    await expect(page.getByTestId("saved-themes-card")).toBeVisible();
    await expect(page.getByTestId("save-as-theme")).toBeVisible();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "published",
    );

    await page.getByTestId("theme-card").filter({ hasText: "Ivory" }).click();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "unpublished-changes",
    );
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expectOverrides(user.pageId, (o) => Object.keys(o).length === 0);
    const row = await pageRow(user.pageId);
    expect(row.draft.theme.ref).toBe("00000000-0000-4000-8000-000000000002");
    await showPreview(page);
    expect(await computed(previewRoot(page), "--t-bg")).not.toBe("#16120E");
  });

  test("M3-06 the bezel is in the page from 760px up and the phone layout has none", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "resizes the viewport itself");
    await seededUser(context, "dsg3");
    await page.setViewportSize({ width: 759, height: 900 });
    await openDesign(page);
    await expect(page.getByTestId("preview-bezel")).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Design view" })).toHaveCount(0);
    await page.setViewportSize({ width: 761, height: 900 });
    await expect(page.getByRole("region", { name: "Live preview" })).toBeVisible();
    await expect(page.locator("[data-page-root]")).toHaveCount(1);
  });

  test("M3-06 mara's Design screen reads, never writes", async ({ page, context }, info) => {
    await signInAs(context, MARA_EMAIL);
    await openDesign(page);
    if (phoneOnly(info)) {
      // A phone draws the page in the mini phone's thumbnail (M7-09).
      await expect(page.getByTestId("mini-phone")).toBeVisible();
    } else {
      await showPreview(page);
      await expect(previewRoot(page)).toBeVisible();
    }
    // Nothing was written by opening it.
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages")) {
        writes.push(request.url());
      }
    });
    await page.waitForTimeout(1500);
    expect(writes).toEqual([]);
  });
});
