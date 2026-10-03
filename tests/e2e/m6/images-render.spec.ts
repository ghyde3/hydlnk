import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import sharp from "sharp";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { userClient } from "../fixtures/auth";
import { expectNoHorizontalScroll, url } from "../helpers";
import {
  accessToken,
  expectDraft,
  openEditor,
  pageRow,
  reloadEditor,
  previewScreen,
  statusChip,
} from "../m2/editor-helpers";
import { showView } from "../m2/blocks-helpers";
import {
  cardBlockOf,
  halves,
  imageBlockOf,
  openPanel,
  pixelAt,
  publishButton,
  userWithBlocks,
} from "./images-helpers";

/**
 * M6-23 on the live page and in the editor preview: a shaped image sits in a frame of its ratio, a
 * focus is `object-position` from two numbers, the preview and the live page draw the same markup,
 * and the Publish gate refuses bad shapes and focus values written straight to the draft.
 */

test.describe.configure({ timeout: 180_000 });
test.afterAll(cleanupUsers);

const IDS = {
  wide: "wideportrait1", // a portrait image as a wide block, with a link
  square: "squarelandsc1", // a landscape image as a square block
  focusLeft: "wideleftfocus", // 3:1 image, wide, focus x = 0
  focusRight: "widerightfocu", // the same, focus x = 1
  card: "cardfocuszero", // a card whose banner has focus x = 0
  cardRight: "cardfocusone1", // and one with focus x = 1
  plain: "plainoriginal", // no shape, no focus: as today
} as const;

const RATIO = { wide: 16 / 9, square: 1 };

async function build(context: BrowserContext, label: string) {
  return userWithBlocks(context, label, async ({ upload }) => {
    const portrait = await upload(await halves(400, 800));
    const landscape = await upload(await halves(800, 400));
    const triple = await upload(await halves(1200, 400));
    return [
      imageBlockOf(portrait, { shape: "wide", url: "https://example.com/wide" }, IDS.wide),
      imageBlockOf(landscape, { shape: "square" }, IDS.square),
      imageBlockOf(triple, { shape: "wide" }, IDS.focusLeft),
      imageBlockOf(triple, { shape: "wide" }, IDS.focusRight),
      cardBlockOf(triple, {}, IDS.card),
      cardBlockOf(triple, {}, IDS.cardRight),
      imageBlockOf(triple, {}, IDS.plain),
    ].map((block, index) => {
      // The focus rides on the image reference.
      const focus =
        index === 2 || index === 4
          ? { x: 0, y: 0.5 }
          : index === 3 || index === 5
            ? { x: 1, y: 0.5 }
            : null;
      const image = (block as unknown as { image: Record<string, unknown> }).image;
      return (focus ? { ...block, image: { ...image, focus } } : block) as typeof block;
    });
  });
}

async function publish(page: Page) {
  await publishButton(page).click();
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
}

const blockOn = (page: Page, id: string): Locator => page.locator(`[data-block-id="${id}"]`);

/** The picture of an image block or a card, once the file has loaded. */
async function loaded(img: Locator): Promise<void> {
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      img.evaluate(
        (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
}

async function centerPixel(target: Locator): Promise<[number, number, number]> {
  const png = await target.screenshot();
  const meta = await sharp(png).metadata();
  return pixelAt(png, Math.floor(meta.width! / 2), Math.floor(meta.height! / 2));
}

const reddish = ([r, , b]: [number, number, number]) => r > b + 60;
const bluish = ([r, , b]: [number, number, number]) => b > r + 60;

async function livePage(browser: Browser, handle: string, project: string) {
  const viewport = project === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(url(handle));
  await expect(page.locator("[data-page-root]")).toBeVisible();
  return { page, context };
}

test.describe("M6-23 the live page", () => {
  test("M6-23 frames are the column's width at their ratio, the picture fills them, anchors are 44px tall, nothing scrolls sideways", async ({
    page,
    context,
    browser,
  }, info) => {
    const user = await build(context, "ir1");
    await openEditor(page);
    await publish(page);

    const live = await livePage(browser, user.handle, info.project.name);
    const lp = live.page;
    const column = (await lp.locator(".pg-blocks").boundingBox())!;

    for (const [id, ratio] of [
      [IDS.wide, RATIO.wide],
      [IDS.square, RATIO.square],
      [IDS.focusLeft, RATIO.wide],
    ] as const) {
      const frame = blockOn(lp, id).locator(".pg-image-frame");
      await expect(frame).toHaveAttribute("data-shape", id === IDS.square ? "square" : "wide");
      const box = (await frame.boundingBox())!;
      expect(Math.abs(box.width - column.width), `${id} is the column's width`).toBeLessThanOrEqual(
        1,
      );
      expect(box.width / box.height, `${id} keeps its ratio`).toBeCloseTo(ratio, 1);
      const img = frame.locator("img");
      await loaded(img);
      const ib = (await img.boundingBox())!;
      // Fills the frame, and is cropped (cover), not stretched.
      expect(Math.abs(ib.width - box.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(ib.height - box.height)).toBeLessThanOrEqual(1);
      expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");
    }

    // Linked image and cards: at least 44px tall.
    const anchor = blockOn(lp, IDS.wide).locator("a.pg-image-link");
    expect((await anchor.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const id of [IDS.card, IDS.cardRight]) {
      expect((await blockOn(lp, id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await expectNoHorizontalScroll(lp);
    if (desktopOnly(info)) {
      // 1440: frames stay in the 480px column and keep their ratios.
      for (const id of [IDS.wide, IDS.square, IDS.focusLeft]) {
        const box = (await blockOn(lp, id).locator(".pg-image-frame").boundingBox())!;
        expect(box.width).toBeLessThanOrEqual(480.5);
      }
      expect((await lp.locator(".pg-blocks").boundingBox())!.width).toBeLessThanOrEqual(480.5);
    }
    if (phoneOnly(info)) {
      expect(
        await lp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await lp.screenshot({
      path: `tmp/screens/m6-image-shapes-${info.project.name}.png`,
      fullPage: true,
    });
    await live.context.close();
  });

  test("M6-23 focus x=0 shows red at the center of a wide image and of a card, focus x=1 shows blue; object-position is exactly '0% 50%' or '100% 50%'", async ({
    page,
    context,
    browser,
  }, info) => {
    const user = await build(context, "ir2");
    await openEditor(page);
    await publish(page);
    const live = await livePage(browser, user.handle, info.project.name);
    const lp = live.page;

    const cases = [
      { id: IDS.focusLeft, img: "img.pg-image-img", position: "0% 50%", check: reddish },
      { id: IDS.focusRight, img: "img.pg-image-img", position: "100% 50%", check: bluish },
      { id: IDS.card, img: "img.pg-card-image", position: "0% 50%", check: reddish },
      { id: IDS.cardRight, img: "img.pg-card-image", position: "100% 50%", check: bluish },
    ];
    for (const c of cases) {
      const img = blockOn(lp, c.id).locator(c.img);
      await loaded(img);
      expect(await img.evaluate((el) => getComputedStyle(el).objectPosition), c.id).toBe(
        c.position,
      );
      const frame =
        c.id === IDS.card || c.id === IDS.cardRight
          ? blockOn(lp, c.id).locator(".pg-card-banner")
          : blockOn(lp, c.id).locator(".pg-image-frame");
      const pixel = await centerPixel(frame);
      expect(c.check(pixel), `${c.id} center ${pixel.join(",")}`).toBe(true);
    }
    // The original shape and no focus: the image as it always was, no inline style.
    const plain = blockOn(lp, IDS.plain);
    await expect(plain.locator(".pg-image-frame")).toHaveCount(0);
    expect(await plain.locator("img").evaluate((el) => el.getAttribute("style"))).toBeNull();
    await live.context.close();
  });

  test("M6-23 the frame's height is the same before and after the file loads (no layout shift)", async ({
    page,
    context,
    browser,
  }, info) => {
    const user = await build(context, "ir3");
    await openEditor(page);
    await publish(page);

    const viewport =
      info.project.name === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const liveContext = await browser.newContext({ viewport });
    const lp = await liveContext.newPage();
    // Hold every picture back for a moment.
    await lp.route("**/storage/v1/object/public/page-media/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await lp.goto(url(user.handle), { waitUntil: "domcontentloaded" });
    const frame = blockOn(lp, IDS.wide).locator(".pg-image-frame");
    await expect(frame).toBeAttached();
    const img = frame.locator("img");
    expect(await img.evaluate((el) => (el as HTMLImageElement).complete)).toBe(false);
    const before = (await frame.boundingBox())!;
    expect(before.height).toBeGreaterThan(40);
    await loaded(img);
    const after = (await frame.boundingBox())!;
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
    await liveContext.close();
  });
});

test.describe("M6-23 parity and the chip", () => {
  test("M6-23 the editor preview and the live page draw identical markup for every shaped image and card; changing only the focus flips the chip", async ({
    page,
    context,
    browser,
  }, info) => {
    const user = await build(context, "ir4");
    await openEditor(page);
    await publish(page);
    // A reload starts the autosave clean: an edit right after Publish can race the screen's refresh.
    await reloadEditor(page);

    await showView(page, "Preview");
    const ids = [
      IDS.wide,
      IDS.square,
      IDS.focusLeft,
      IDS.focusRight,
      IDS.card,
      IDS.cardRight,
      IDS.plain,
    ];
    const preview: Record<string, string> = {};
    for (const id of ids) {
      preview[id] = await previewScreen(page)
        .locator(`[data-block-id="${id}"]`)
        .evaluate((el) => el.outerHTML);
    }
    const live = await livePage(browser, user.handle, info.project.name);
    for (const id of ids) {
      const html = await blockOn(live.page, id).evaluate((el) => el.outerHTML);
      expect(html, id).toBe(preview[id]);
    }
    await live.context.close();

    // Changing only the focus (a keyboard nudge on the marker) makes the page "Unpublished changes".
    await showView(page, "Blocks");
    const panel = await openPanel(page, IDS.focusLeft);
    await panel.getByRole("button", { name: "Focus point" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    // And putting it back is "Published" again: the published form is what is compared.
    await page.keyboard.press("ArrowLeft");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
  });
});

test.describe("M6-23 the Publish gate", () => {
  test("M6-23 a bad shape and bad focus values written straight to the draft are refused at Publish; the live page keeps its old content; a hidden block with bad values does not block Publish", async ({
    page,
    context,
    browser,
  }, info) => {
    const user = await build(context, "ir5");
    // First publish a good page: this is the "old content".
    await openEditor(page);
    await publish(page);
    await page.waitForLoadState("networkidle");
    const goodRow = await pageRow(user.pageId);
    const goodLive = await livePage(browser, user.handle, info.project.name);
    const oldHtml = await goodLive.page.locator(".pg-blocks").evaluate((el) => el.outerHTML);
    await goodLive.context.close();

    // Now write three bad blocks straight to the draft with the publishable key (curl-equivalent),
    // as the signed-in user, plus one hidden block that is just as bad.
    const token = await accessToken(context);
    const client = userClient(token);
    const bad = (
      extra: Record<string, unknown>,
      ref: Record<string, unknown>,
      id: string,
      visible = true,
    ) => ({
      ...imageBlockOf(
        {
          path: (goodRow.draft.blocks[0] as unknown as { image: { path: string } }).image.path,
          width: 400,
          height: 800,
        },
        extra,
        id,
      ),
      visible,
      image: {
        path: (goodRow.draft.blocks[0] as unknown as { image: { path: string } }).image.path,
        width: 400,
        height: 800,
        ...ref,
      },
    });
    const draft = {
      ...goodRow.draft,
      rev: goodRow.draft.rev + 5,
      blocks: [
        bad({ shape: 'x"><b>' }, {}, "badshapeblk1"),
        bad({ shape: "wide" }, { focus: { x: 5, y: "a" } }, "badfocusblk1"),
        bad({ shape: "wide" }, { focus: { x: null } }, "nullfocusblk"),
        bad({ shape: 'x"><b>' }, { focus: { x: 5, y: 5 } }, "hiddenbadblk", false),
      ],
    };
    const { error } = await client.from("pages").update({ draft }).eq("id", user.pageId);
    expect(error).toBeNull();

    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await publishButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "Fix 3 blocks before publishing." });
    await expect(alert).toBeVisible();
    // Each failing block is named by its row, with its sentence.
    await expect(alert).toContainText("Pick a shape from the list.");
    await expect(alert).toContainText("Choose a focus point inside the image.");
    await expect(page.locator('li[data-block-id="hiddenbadblk"][data-invalid]')).toHaveCount(0);

    // pages.published is exactly what it was, and the live page renders the old content.
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(goodRow.published);
    expect(after.published_at).toBe(goodRow.published_at);
    const live = await livePage(browser, user.handle, info.project.name);
    expect(await live.page.locator(".pg-blocks").evaluate((el) => el.outerHTML)).toBe(oldHtml);
    expect(await live.page.locator("b").count()).toBe(0);
    await live.context.close();

    // With only the hidden block bad, Publish goes through and the hidden block is not on the page.
    const onlyHidden = {
      ...draft,
      rev: draft.rev + 5,
      blocks: [draft.blocks[3]!, { ...draft.blocks[0]!, shape: "wide", id: "okwideblock1" }],
    };
    const second = await client.from("pages").update({ draft: onlyHidden }).eq("id", user.pageId);
    expect(second.error).toBeNull();
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
    const published = (await pageRow(user.pageId)).published as { blocks: { id: string }[] };
    expect(published.blocks.map((b) => b.id)).toEqual(["okwideblock1"]);
    await expectDraft(user.pageId, () => true);
  });
});
