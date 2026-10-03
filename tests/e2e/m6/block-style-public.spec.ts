import { expect, test, type Browser } from "@playwright/test";
import { signInAs } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { openEditor, pageRow } from "../m2/editor-helpers";
import { DESIGN_URL, setOverrides, waitForDesignHydrated } from "../m3/design-helpers";
import { expectStoredTheme, savedThemesCard, themeCard, themeRowsOf } from "../m3/themes-helpers";
import {
  COLOR,
  ID,
  PAIRS,
  PLAIN_LOOK,
  SHAPED_ID,
  RGB,
  STYLED_LOOK,
  blockIn,
  looksOf,
  previewScreen,
  publishViaEditor,
  styledUser,
  styles,
  type Look,
} from "./block-style-helpers";

/**
 * M6-45 on a published page and in the editor's preview: every block type draws its own overrides
 * (header text color, text paragraph color, image, embed and grid borders and radii, social icon
 * colors, the divider line, link and card as before), the sibling beside each one is unchanged,
 * nothing leaks, the layout holds at 390 and 1440, the preview shows the same computed styles as
 * the live page, and applying or saving a theme leaves block overrides alone.
 *
 * One page with two blocks of every type is published once per project (the first of each pair
 * styled, the second plain) and read by every test of the group.
 */

test.describe.configure({ timeout: 240_000 });
test.afterAll(cleanupUsers);

const IMAGE_PLAIN_COLOR = "";

let shared: { handle: string; email: string; pageId: string };

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const user = await styledUser(context, "bspub");
  await openEditor(page);
  await publishViaEditor(page);
  shared = { handle: user.handle, email: user.email, pageId: user.pageId };
  await context.close();
});

async function livePage(browser: Browser, project: string) {
  const viewport = project === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(url(shared.handle));
  await expect(page.locator("[data-page-root]")).toBeVisible();
  return { page, context };
}

/** A look with the border color of an image that has no border left out (it is `currentcolor`). */
function comparable(look: Look): unknown {
  const copy = styles(look) as Look;
  // A border of width 0 draws nothing, whatever its style says (the editor's reset sets `solid` on
  // every element, the live page has none): only its width matters.
  copy.image = {
    ...copy.image,
    color: IMAGE_PLAIN_COLOR,
    style: copy.image.width === "0px" ? "none" : copy.image.style,
  };
  return copy;
}

test.describe("M6-45 the live page", () => {
  test("M6-45 #C46A4F on each color key, 20 on radius and 2 on borderWidth: every block type shows it, and its sibling shows the theme", async ({
    browser,
  }, info) => {
    const live = await livePage(browser, info.project.name);
    const root = live.page.locator("[data-page-root]");

    const styled = await looksOf(root, "a");
    expect(styled.header.color).toBe(RGB);
    expect(styled.text.color).toBe(RGB);
    expect(styled.image).toEqual({ width: "2px", style: "solid", color: RGB, radius: "20px" });
    expect(styled.embed).toEqual({ width: "2px", style: "solid", color: RGB, radius: "20px" });
    expect(styled.spotify).toEqual({ width: "2px", style: "solid", color: RGB, radius: "20px" });
    expect(styled.cell).toMatchObject({
      width: "2px",
      style: "solid",
      color: RGB,
      radius: "20px",
      titleColor: RGB,
    });
    expect(styled.social).toMatchObject({ color: RGB, borderColor: RGB });
    expect(styled.divider.background).toBe(RGB);
    expect(styled.link).toMatchObject({ background: RGB, borderColor: RGB, radius: "20px" });
    expect(styled.card).toEqual({ titleColor: RGB, borderColor: RGB, radius: "20px" });
    expect(comparable(styled)).toEqual(comparable(STYLED_LOOK));

    // The sibling beside each one is the theme, unchanged. An image has no border until it sets a
    // thickness, so its default look is the same as before.
    const plain = await looksOf(root, "b");
    expect(plain.image.width).toBe("0px");
    expect(plain.image.radius).toBe(PLAIN_LOOK.image.radius);
    expect(comparable(plain)).toEqual(comparable(PLAIN_LOOK));

    await live.context.close();
  });

  test("M6-45 each override is inline --t-* variables on the block's own element and nowhere else; no --hl- variable", async ({
    browser,
  }, info) => {
    const live = await livePage(browser, info.project.name);
    const p = live.page;
    const styledIds = [...PAIRS.map((pair) => ID[pair].a), SHAPED_ID];
    const plainIds = PAIRS.map((pair) => ID[pair].b);

    for (const id of styledIds) {
      const style = (await blockIn(p, id).getAttribute("style")) ?? "";
      expect(style, id).toContain(`--t-radius:20px`);
      expect(style, id).toContain(`--t-border-width:2px`);
      expect(style, id).toContain(`--t-text:${COLOR}`);
      expect(style, id).not.toMatch(/--hl-/);
    }
    for (const id of plainIds) {
      expect(await blockIn(p, id).getAttribute("style"), id).toBeNull();
    }
    // Only the block roots carry an inline style: not a cell, an icon, a picture or a frame.
    const inline = await p.evaluate(() =>
      Array.from(document.querySelectorAll("[data-page-root] [style]")).map(
        (el) => el.getAttribute("data-block-id") ?? el.className,
      ),
    );
    expect([...inline].sort()).toEqual([...styledIds].sort());
    // The page root's own variables are the page's: no override reached it.
    const rootStyle = (await p.locator("[data-page-root]").getAttribute("style")) ?? "";
    expect(rootStyle).toContain("--t-radius:12px");
    expect(rootStyle).toContain("--t-border-width:1px");
    expect(rootStyle).not.toContain(COLOR);
    expect(await p.content()).not.toMatch(/--hl-/);
    // Only the image that sets a thickness is drawn bordered.
    await expect(blockIn(p, ID.image.a)).toHaveAttribute("data-bordered", "true");
    await expect(blockIn(p, ID.image.b)).not.toHaveAttribute("data-bordered", /.*/);
    await live.context.close();
  });

  test("M6-45 a shaped, linked image: the radius is on its frame and its picture, the border on its picture, and the frame keeps its ratio", async ({
    browser,
  }, info) => {
    const live = await livePage(browser, info.project.name);
    const p = live.page;
    const block = blockIn(p, SHAPED_ID);
    const frame = block.locator(".pg-image-frame");
    const img = frame.locator("img");
    await expect(block.locator("a.pg-image-link")).toHaveCount(1);
    await expect(frame).toHaveAttribute("data-shape", "square");
    expect(await frame.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("20px");
    expect(await img.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("20px");
    expect(await img.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("2px");
    expect(await img.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
    expect(await img.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(RGB);
    // Still a square, the column's width, with the border inside it.
    const box = (await frame.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    const column = (await p.locator(".pg-blocks").boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(column.width + 0.5);
    const imgBox = (await img.boundingBox())!;
    expect(imgBox.width).toBeLessThanOrEqual(box.width + 0.5);
    await expectNoHorizontalScroll(p);
    await live.context.close();
  });

  test("M6-45 at 390x844 nothing scrolls sideways, icons and cells stay 44px tall and 2px borders stay inside the page padding", async ({
    browser,
  }, info) => {
    test.skip(!phoneOnly(info), "390x844");
    const live = await livePage(browser, "phone");
    const p = live.page;
    expect(await p.evaluate(() => innerWidth)).toBe(390);
    await expectNoHorizontalScroll(p);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    for (const which of ["a", "b"] as const) {
      const look = await looksOf(p.locator("[data-page-root]"), which);
      expect(look.social.width, `${which} icon`).toBeGreaterThanOrEqual(44);
      expect(look.social.height, `${which} icon`).toBeGreaterThanOrEqual(44);
      expect(look.cell.height, `${which} cell`).toBeGreaterThanOrEqual(44);
    }
    const outside = await p.evaluate(() => {
      const column = document.querySelector(".pg-blocks")!.getBoundingClientRect();
      return Array.from(document.querySelectorAll("[data-block-id]"))
        .map((el) => ({ id: el.getAttribute("data-block-id")!, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left < column.left - 0.5 || rect.right > column.right + 0.5)
        .map(({ id }) => id);
    });
    expect(outside).toEqual([]);
    // The column keeps the page padding: 24px on each side at this width.
    const column = await p.locator(".pg-blocks").boundingBox();
    expect(column!.x).toBeGreaterThanOrEqual(23.5);
    expect(column!.x + column!.width).toBeLessThanOrEqual(390 - 23.5);
    await p.screenshot({ path: "tmp/screens/m6-block-style-live-phone.png", fullPage: true });
    await live.context.close();
  });

  test("M6-45 at 1440x900 every block stays inside the 480px column", async ({ browser }, info) => {
    test.skip(!desktopOnly(info), "1440x900");
    const live = await livePage(browser, "desktop");
    const p = live.page;
    expect(await p.evaluate(() => innerWidth)).toBe(1440);
    await expectNoHorizontalScroll(p);
    const column = (await p.locator(".pg-blocks").boundingBox())!;
    expect(column.width).toBeLessThanOrEqual(480.5);
    const outside = await p.evaluate(() => {
      const box = document.querySelector(".pg-blocks")!.getBoundingClientRect();
      return Array.from(document.querySelectorAll("[data-block-id]"))
        .map((el) => ({ id: el.getAttribute("data-block-id")!, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
        .map(({ id }) => id);
    });
    expect(outside).toEqual([]);
    await p.screenshot({ path: "tmp/screens/m6-block-style-live-desktop.png", fullPage: true });
    await live.context.close();
  });
});

test.describe("M6-45 the editor preview", () => {
  test("M6-45 the preview shows the same computed styles as the live page, block by block", async ({
    browser,
    context,
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "1440x900");
    await signInAs(context, shared.email);
    await openEditor(page);
    const preview = previewScreen(page);
    await expect(preview).toBeVisible();

    const previewStyled = await looksOf(preview, "a");
    const previewPlain = await looksOf(preview, "b");
    const live = await livePage(browser, "desktop");
    const root = live.page.locator("[data-page-root]");
    const liveStyled = await looksOf(root, "a");
    const livePlain = await looksOf(root, "b");

    expect(comparable(previewStyled)).toEqual(comparable(liveStyled));
    expect(comparable(previewPlain)).toEqual(comparable(livePlain));
    expect(comparable(previewStyled)).toEqual(comparable(STYLED_LOOK));
    expect(comparable(previewPlain)).toEqual(comparable(PLAIN_LOOK));

    // The same markup on the block's own element: the preview and the live page agree on the style.
    for (const pair of PAIRS) {
      const a = await blockIn(preview, ID[pair].a).getAttribute("style");
      const b = await blockIn(live.page, ID[pair].a).getAttribute("style");
      expect(a, pair).toBe(b);
    }
    await live.context.close();
  });
});

test.describe("M6-45 themes and block overrides", () => {
  async function overridesById(pageId: string): Promise<Record<string, unknown>> {
    const draft = (await pageRow(pageId)).draft;
    return Object.fromEntries(
      draft.blocks.map((block) => [block.id, (block as { overrides?: unknown }).overrides ?? null]),
    );
  }

  test("M6-45 applying a theme and saving as a theme neither copy nor clear block overrides; a block's own override wins over a changed page color", async ({
    browser,
    context,
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "data flow: one viewport");
    const user = await styledUser(context, "bsthm", { plan: "pro" });
    const before = await overridesById(user.pageId);
    for (const pair of PAIRS) expect(before[ID[pair].a], pair).not.toBeNull();
    for (const pair of PAIRS) expect(before[ID[pair].b], pair).toBeNull();

    // Apply a theme (M3-20).
    await page.goto(DESIGN_URL);
    await waitForDesignHydrated(page);
    await expect(savedThemesCard(page)).toBeVisible();
    await themeCard(page, "Ivory").click();
    await expectStoredTheme(user.pageId, (t) => t.ref === "00000000-0000-4000-8000-000000000002");
    expect(await overridesById(user.pageId)).toEqual(before);

    // Save as theme (M3-21): the saved theme is tokens only, and the blocks are untouched.
    await page.getByRole("button", { name: "Save as theme" }).click();
    await expectStoredTheme(user.pageId, (t) => t.ref !== "00000000-0000-4000-8000-000000000002");
    expect(await overridesById(user.pageId)).toEqual(before);
    const saved = await themeRowsOf(user.userId);
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0]!.tokens)).not.toContain(COLOR);

    // The page's own text color changes: the plain heading follows it, the styled one does not.
    await setOverrides(user.pageId, { text: "#00AA00", textMuted: "#AA0000", border: "#0000AA" });
    await openEditor(page);
    const preview = previewScreen(page);
    await expect
      .poll(() => blockIn(preview, ID.header.b).evaluate((el) => getComputedStyle(el).color))
      .toBe("rgb(0, 170, 0)");
    expect(await blockIn(preview, ID.header.a).evaluate((el) => getComputedStyle(el).color)).toBe(
      RGB,
    );
    expect(await blockIn(preview, ID.text.a).evaluate((el) => getComputedStyle(el).color)).toBe(
      RGB,
    );
    expect(await blockIn(preview, ID.text.b).evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(170, 0, 0)",
    );
    expect(
      await blockIn(preview, ID.divider.a).evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(RGB);
    expect(
      await blockIn(preview, ID.divider.b).evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(0, 0, 170)");

    // And after Publish, on the live page.
    await publishViaEditor(page);
    const live = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const lp = await live.newPage();
    await lp.goto(url(user.handle));
    expect(await blockIn(lp, ID.header.a).evaluate((el) => getComputedStyle(el).color)).toBe(RGB);
    expect(await blockIn(lp, ID.header.b).evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(0, 170, 0)",
    );
    await live.close();
  });
});
