import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { LIMITS, newBlockId } from "@/lib/document";
import {
  bezel,
  css,
  emptyUser,
  mark,
  openEditor,
  previewScreen,
  rows,
  saveIndicator,
  seededUser,
} from "./editor-helpers";

/** M2-06: the live preview beside the editor, and Blocks | Preview tabs on a phone. */

test.afterAll(cleanupUsers);

const NAME = (page: import("@playwright/test").Page) =>
  page.getByLabel("Display name", { exact: true });
const previewRegion = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Live preview" });
const blocksRegion = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Blocks", exact: true });

/** `n` blocks, each a text block with its own id, for the scroll tests. */
function manyBlocks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: newBlockId(),
    type: "text",
    visible: true,
    text: `Line ${i + 1} of the long page`,
  }));
}

async function seedBlocks(pageId: string, handle: string, blocks: unknown[]) {
  const { error } = await adminClient()
    .from("pages")
    .update({
      draft: {
        version: 1,
        rev: 0,
        profile: { name: handle, bio: "A long page", photo: null },
        theme: { ref: "00000000-0000-4000-8000-000000000001", overrides: {} },
        blocks,
      },
    })
    .eq("id", pageId);
  if (error) throw new Error(error.message);
}

test.describe("M2-06 desktop: two columns", () => {
  test("M2-06 the block column (max 720px) and a 330px Live preview column with a 310x660 bezel", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "pv1");
    await openEditor(page);
    await expect(page.getByRole("tablist")).toHaveCount(0);

    const list = (await blocksRegion(page).boundingBox())!;
    const column = (await previewRegion(page).boundingBox())!;
    expect(list.width).toBeLessThanOrEqual(720);
    expect(list.width).toBeGreaterThan(600);
    expect(column.width).toBe(330);
    expect(column.x).toBeGreaterThanOrEqual(list.x + list.width);

    const label = previewRegion(page).getByText("Live preview", { exact: true });
    await expect(label).toBeVisible();
    expect(await css(label, "text-transform")).toBe("uppercase");
    expect(await css(label, "font-family")).toMatch(/Geist.?Mono/);
    await expect(previewRegion(page).getByText("Your page's own theme")).toBeVisible();

    const frame = (await bezel(page).boundingBox())!;
    expect(frame.width).toBe(310);
    expect(frame.height).toBe(660);
    expect(await css(bezel(page), "border-top-left-radius")).toBe("38px");
    expect(await css(bezel(page), "border-top-width")).toBe("1px");
    expect(await css(bezel(page), "border-top-color")).toBe("rgb(201, 197, 190)");
    expect(await css(bezel(page), "background-color")).toBe("rgb(28, 27, 26)");
    expect(await css(bezel(page), "padding-top")).toBe("9px");
    expect(await css(previewScreen(page), "border-top-left-radius")).toBe("30px");
    expect(await css(previewScreen(page), "overflow-y")).toBe("auto");
    // The renderer is inside the frame.
    await expect(previewScreen(page).locator("[data-page-root]")).toHaveCount(1);
  });

  test("M2-06 typing in Display name changes the preview heading before the save returns", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pv2");
    await openEditor(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/rest/v1/pages?*", async (route) => {
      if (route.request().method() === "PATCH") await gate;
      await route.continue();
    });
    const text = mark();
    await NAME(page).fill(text);
    await expect(previewScreen(page).locator("h1")).toHaveText(text);
    await page.waitForTimeout(1200); // the PATCH is in flight and held
    await expect(saveIndicator(page)).toHaveText("Saving...");
    await expect(previewScreen(page).locator("h1")).toHaveText(text);
    release();
    await expect(saveIndicator(page)).toHaveText("Saved");
  });

  test("M2-06 the preview scrolls inside the bezel: with 15 blocks the last block and the footer are reachable", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await emptyUser(context, "pv3"); // free plan: the footer badge shows
    const blocks = manyBlocks(15);
    await seedBlocks(user.pageId, user.handle, blocks);
    await openEditor(page);
    const screen = previewScreen(page);
    const sizes = await screen.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);

    const last = screen.locator(`[data-block-id="${blocks[14]!.id}"]`);
    const footer = screen.locator("[data-page-footer]");
    await expect(footer).toHaveCount(1);
    await screen.evaluate((el) => (el.scrollTop = el.scrollHeight));
    for (const target of [last, footer]) {
      const box = (await target.boundingBox())!;
      const frame = (await screen.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(frame.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
    }
  });

  test("M2-06 the preview column stays in view while the block list scrolls (30 blocks)", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await emptyUser(context, "pv4");
    await seedBlocks(user.pageId, user.handle, manyBlocks(30));
    await openEditor(page);
    await expect(rows(page)).toHaveCount(30);
    const before = (await bezel(page).boundingBox())!;
    await page.evaluate(() => window.scrollTo(0, 1600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const after = (await bezel(page).boundingBox())!;
    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(after.y + after.height).toBeLessThanOrEqual(900);
    expect(after.y).toBeLessThan(before.y); // it moved up under the header, then stuck
    expect(after.y).toBeLessThan(60); // 16px under the top plus the label row
  });

  test("M2-06 style isolation: the root takes the draft's bg token, no --hl variable is used inside, links do not navigate", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "pv5");
    await openEditor(page);
    if (phoneOnly(info)) await page.getByRole("tab", { name: "Preview" }).click();
    const root = previewScreen(page).locator("[data-page-root]");
    // Noir's bg, resolved: #16120E.
    expect(await css(root, "background-color")).toBe("rgb(22, 18, 14)");
    expect(await css(root, "background-color")).not.toBe("rgb(244, 243, 240)");
    expect(await root.evaluate((el) => (el as HTMLElement).style.cssText)).not.toContain("--hl-");
    expect(await root.getAttribute("style")).toContain("--t-bg");

    const leaks = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let list: CSSRuleList;
        try {
          list = sheet.cssRules;
        } catch {
          continue;
        }
        const visit = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            if (rule.cssText.includes("data-page-root") && rule.cssText.includes("--hl-")) {
              found.push(rule.cssText.slice(0, 120));
            }
            if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
          }
        };
        visit(list);
      }
      return found;
    });
    expect(leaks).toEqual([]);

    // A link and a social icon inside the preview do not navigate and do not open tabs.
    const popups: unknown[] = [];
    context.on("page", (p) => popups.push(p));
    const startUrl = page.url();
    const link = previewScreen(page).locator("a[href]").first();
    await link.click();
    // M6-03: on a phone a tap in the full-size preview opens the block, which switches to the Blocks tab.
    if (phoneOnly(info)) await page.getByRole("tab", { name: "Preview" }).click();
    const social = previewScreen(page).locator("[data-block-type='social'] a").first();
    await social.click();
    await page.waitForTimeout(500);
    expect(page.url()).toBe(startUrl);
    expect(popups).toHaveLength(0);
    // The social tap opened its block (M6-03), which is the Blocks tab on a phone.
    if (phoneOnly(info)) await page.getByRole("tab", { name: "Preview" }).click();
    await expect(previewScreen(page)).toBeVisible();
  });
});

test.describe("M2-06 phone: Blocks | Preview tabs", () => {
  test("M2-06 the tablist, its two tabs and their look", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "pt1");
    await openEditor(page);
    const tablist = page.getByRole("tablist", { name: "Editor view" });
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveText(["Blocks", "Preview"]);
    const blocks = tablist.getByRole("tab", { name: "Blocks" });
    const preview = tablist.getByRole("tab", { name: "Preview" });
    await expect(blocks).toHaveAttribute("aria-selected", "true");
    await expect(preview).toHaveAttribute("aria-selected", "false");

    expect(await css(tablist, "background-color")).toBe("rgb(239, 237, 233)");
    expect(await css(tablist, "border-top-width")).toBe("1px");
    expect(await css(tablist, "border-top-color")).toBe("rgb(226, 223, 217)");
    expect(await css(tablist, "border-top-left-radius")).toBe("6px");
    expect(await css(blocks, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(blocks, "box-shadow")).toContain("rgb(217, 214, 208)");
    expect(await css(blocks, "border-top-left-radius")).toBe("4px");
    for (const tab of [blocks, preview]) {
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Only one panel at a time.
    await expect(blocksRegion(page).or(page.locator("#editor-panel-blocks"))).toBeVisible();
    await expect(page.locator("#editor-panel-blocks")).toBeVisible();
    await expect(page.locator("#editor-panel-preview")).toBeHidden();
    await preview.click();
    await expect(preview).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#editor-panel-preview")).toBeVisible();
    await expect(page.locator("#editor-panel-blocks")).toBeHidden();
  });

  test("M2-06 the Preview tab: full width, no bezel; no sideways scroll and 44px targets on both tabs", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "pt2");
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(previewScreen(page)).toBeVisible();
    expect(await css(bezel(page), "border-top-width")).toBe("0px");
    expect(await css(bezel(page), "background-color")).toBe("rgba(0, 0, 0, 0)");
    const box = (await bezel(page).boundingBox())!;
    expect(box.x).toBe(16);
    expect(box.width).toBe(390 - 32);
    const screen = (await previewScreen(page).boundingBox())!;
    expect(screen.width).toBe(390 - 32);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main > header, [role='tablist']");
  });

  test("M2-06 arrow keys, Home and End move between the tabs", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "pt3");
    await openEditor(page);
    const blocks = page.getByRole("tab", { name: "Blocks" });
    const preview = page.getByRole("tab", { name: "Preview" });
    await blocks.focus();
    await page.keyboard.press("ArrowRight");
    await expect(preview).toBeFocused();
    await expect(preview).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight"); // wraps
    await expect(blocks).toBeFocused();
    await expect(blocks).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft"); // wraps
    await expect(preview).toBeFocused();
    await page.keyboard.press("Home");
    await expect(blocks).toBeFocused();
    await page.keyboard.press("End");
    await expect(preview).toBeFocused();
    await expect(preview).toHaveAttribute("aria-selected", "true");
    // Roving tabindex: only the selected tab is in the tab order.
    await expect(blocks).toHaveAttribute("tabindex", "-1");
    await expect(preview).toHaveAttribute("tabindex", "0");
  });

  test("M2-06 a name typed on the Blocks tab shows on the Preview tab with no reload and no Publish", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "pt4");
    await openEditor(page);
    const text = mark();
    await NAME(page).fill(text);
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(previewScreen(page).locator("h1")).toHaveText(text);
    await page.getByRole("tab", { name: "Blocks" }).click();
    await expect(NAME(page)).toHaveValue(text);
  });
});

test.describe("M2-06 breakpoint", () => {
  test("M2-06 at 759px the tabs show and the bezel does not; at 760px and 800px the two columns sit side by side", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "sets its own viewports");
    await seededUser(context, "bp");
    await page.setViewportSize({ width: 759, height: 844 });
    await openEditor(page);
    await expect(page.getByRole("tablist", { name: "Editor view" })).toBeVisible();
    expect(await css(bezel(page), "border-top-width")).toBe("0px");
    await expectNoHorizontalScroll(page);

    await page.setViewportSize({ width: 760, height: 900 });
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(blocksRegion(page)).toBeVisible();
    const list = (await blocksRegion(page).boundingBox())!;
    const frame = (await bezel(page).boundingBox())!;
    expect(frame.width).toBe(310);
    expect(frame.height).toBe(660);
    expect(frame.x).toBeGreaterThanOrEqual(list.x + list.width - 1); // beside, not below
    expect(frame.y).toBeLessThan(list.y + 200);
    await expectNoHorizontalScroll(page);

    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("tablist")).not.toBeVisible();
    await expectNoHorizontalScroll(page);
    void LIMITS;
  });
});

test.describe("M2-28 / M2-29 the preview shows the same footer as the live page", () => {
  /** The phone shows the preview on its own tab; at 760px and up it is always there. */
  async function showPreview(page: import("@playwright/test").Page) {
    const tab = page.getByRole("tab", { name: "Preview" });
    if (await tab.isVisible()) await tab.click();
  }

  test("a free page: Made with HYDLNK and Report this page, and a click on either leaves the editor in place", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pf1", { plan: "free" });
    await openEditor(page);
    await showPreview(page);
    const editorUrl = page.url();

    const footer = previewScreen(page).locator("[data-page-footer]");
    const badge = footer.getByRole("link", { name: "Made with HYDLNK" });
    const report = footer.getByRole("link", { name: "Report this page" });
    await expect(badge).toHaveAttribute("href", "http://localhost:3000");
    await expect(badge).toHaveAttribute("rel", "noopener");
    await expect(report).toHaveAttribute(
      "href",
      `http://localhost:3000/report?page=${user.pageId}`,
    );

    await badge.click();
    await report.click();
    expect(page.url()).toBe(editorUrl);
    expect(page.context().pages()).toHaveLength(1);
  });

  test("a pro page: no badge, but the report link stays", async ({ page, context }) => {
    const user = await emptyUser(context, "pf2", { plan: "pro" });
    await openEditor(page);
    await showPreview(page);
    const footer = previewScreen(page).locator("[data-page-footer]");
    await expect(footer.getByRole("link", { name: "Report this page" })).toHaveAttribute(
      "href",
      `http://localhost:3000/report?page=${user.pageId}`,
    );
    await expect(footer.getByRole("link", { name: "Made with HYDLNK" })).toHaveCount(0);
  });
});
