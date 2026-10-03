import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { showView } from "../m2/blocks-helpers";
import {
  css,
  expectDraft,
  openEditor,
  previewScreen,
  reloadEditor,
  setDraft,
  statusChip,
} from "../m2/editor-helpers";
import {
  cardBlockOf,
  draftOfPage,
  halves,
  imageBlockOf,
  openPanel,
  publishButton,
  userWithBlocks,
} from "./images-helpers";

/**
 * M6-25: the Shape select and the focus control of the image and card blocks, in the editor. Each
 * test makes its own user with real uploaded images (3:1, left half red, right half blue), so the
 * pictures the picker and the preview draw are real.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const FOCUS_SENTENCE = "Choose a focus point inside the image.";
const SHAPE_SENTENCE = "Pick a shape from the list.";

const picker = (panel: Locator) => panel.getByTestId("focus-picker");
const picture = (panel: Locator) => panel.getByTestId("focus-picture");
const marker = (panel: Locator) => panel.getByRole("button", { name: "Focus point" });
const strip = (panel: Locator) => panel.getByTestId("focus-strip");
const shapeSelect = (panel: Locator) => panel.getByLabel("Shape", { exact: true });
const centerButton = (panel: Locator) => panel.getByRole("button", { name: "Center", exact: true });
const live = (panel: Locator) => panel.getByTestId("focus-live");

async function setup(context: import("@playwright/test").BrowserContext, label: string) {
  return userWithBlocks(context, label, async ({ upload }) => {
    const wide = await upload(await halves(1200, 400));
    const banner = await upload(await halves(1200, 400, { format: "jpeg" }), {
      filename: "banner.jpg",
      contentType: "image/jpeg",
    });
    return [imageBlockOf(wide, {}, "imgblock0001"), cardBlockOf(banner, {}, "cardblock001")];
  });
}

const ids = { image: "imgblock0001", card: "cardblock001" };

/** The two numbers of a locator's inline `object-position` as percentages, or null. */
const positionOf = (locator: Locator) =>
  locator.evaluate((el) => (el as HTMLElement).style.objectPosition || null);

/** Scrolls an element to the middle of the screen, clear of the phone's fixed tab bar. */
const centerInView = (locator: Locator) =>
  locator.evaluate((el) => el.scrollIntoView({ block: "center" }));

async function clickPicture(page: Page, pic: Locator, fx: number, fy: number) {
  await centerInView(pic);
  const box = (await pic.boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test.describe("M6-25 the Shape select", () => {
  test("M6-25 Shape sits under the upload control; Original shows a hint and no focus control; a shape updates the preview and autosaves", async ({
    page,
    context,
  }, info) => {
    const user = await setup(context, "fs1");
    await openEditor(page);
    const panel = await openPanel(page, ids.image);

    const select = shapeSelect(panel);
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options).toEqual(["Original", "Square", "Landscape", "Wide"]);
    await expect(select).toHaveValue("original");
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await css(select, "font-size")).toBe("16px");

    // Under the upload control, above the alt text.
    const upload = (await panel.getByRole("button", { name: "Replace image" }).boundingBox())!;
    const shape = (await select.boundingBox())!;
    const alt = (await panel.getByLabel("Alt text").boundingBox())!;
    expect(shape.y).toBeGreaterThan(upload.y);
    expect(shape.y).toBeLessThan(alt.y);

    // Original: the hint, and no focus control.
    await expect(panel.getByText("Choose a shape to crop and position the image.")).toBeVisible();
    await expect(picker(panel)).toHaveCount(0);

    await select.selectOption("wide");
    await expect(picker(panel)).toBeVisible();
    await expect(panel.getByText("Choose a shape to crop and position the image.")).toHaveCount(0);
    await showView(page, "Preview");
    const frame = previewScreen(page).locator(`[data-block-id="${ids.image}"] .pg-image-frame`);
    await expect(frame).toHaveAttribute("data-shape", "wide");
    const box = (await frame.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
    await showView(page, "Blocks");

    const draft = await expectDraft(
      user.pageId,
      (d) => (d.blocks[0] as { shape?: string }).shape === "wide",
    );
    expect((draft.blocks[0] as { shape?: string }).shape).toBe("wide");

    for (const [value, ratio] of [
      ["square", 1],
      ["landscape", 4 / 3],
    ] as const) {
      await select.selectOption(value);
      await showView(page, "Preview");
      await expect(frame).toHaveAttribute("data-shape", value);
      const b = (await frame.boundingBox())!;
      expect(b.width / b.height).toBeCloseTo(ratio, 1);
      await showView(page, "Blocks");
    }

    // Original removes the key and the frame; the focus control goes.
    await select.selectOption("original");
    await expect(picker(panel)).toHaveCount(0);
    await expectDraft(user.pageId, (d) => !("shape" in d.blocks[0]!));
    await showView(page, "Preview");
    await expect(
      previewScreen(page).locator(`[data-block-id="${ids.image}"] .pg-image-frame`),
    ).toHaveCount(0);
    expect(info.project.name).toBeTruthy();
  });

  test("M6-25 a Free user sees no Pro chip, and the controls make no request of their own", async ({
    page,
    context,
  }) => {
    await setup(context, "fs2");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await openEditor(page);
    const imagePanel = await openPanel(page, ids.image);
    await shapeSelect(imagePanel).selectOption("square");
    await expect(picker(imagePanel)).toBeVisible();
    await expect(imagePanel.getByText("Pro", { exact: true })).toHaveCount(0);
    const cardPanel = await openPanel(page, ids.card);
    await expect(picker(cardPanel)).toBeVisible();
    await expect(cardPanel.getByText("Pro", { exact: true })).toHaveCount(0);
    await clickPicture(page, picture(cardPanel), 0.2, 0.2);
    await expect.poll(() => requests.some((path) => path === "/api/media")).toBe(false);
  });
});

test.describe("M6-25 the focus control", () => {
  test("M6-25 clicking the picture sets the focus: the draft, the strip, the preview and the chip follow; Center removes it", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "fp1");
    await openEditor(page);
    // Publish first so the chip can flip.
    const panel = await openPanel(page, ids.image);
    await shapeSelect(panel).selectOption("wide");
    await expectDraft(user.pageId, (d) => (d.blocks[0] as { shape?: string }).shape === "wide");
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
    // Publish refreshes the screen's server data; an edit that lands before that settles can be
    // refused as stale (a Wave F behavior, noted in the M6-23..25 hand-off). A reload starts clean.
    await reloadEditor(page);
    await openPanel(page, ids.image);

    await clickPicture(page, picture(panel), 0.25, 0.75);
    const stored = await expectDraft(user.pageId, (d) => {
      const image = (d.blocks[0] as { image: { focus?: { x: number; y: number } } }).image;
      return image.focus !== undefined;
    });
    const focus = (stored.blocks[0] as { image: { focus: { x: number; y: number } } }).image.focus;
    expect(focus.x).toBeCloseTo(0.25, 1);
    expect(focus.y).toBeCloseTo(0.75, 1);
    // Rounded to three decimals.
    for (const value of [focus.x, focus.y]) expect(Math.round(value * 1000) / 1000).toBe(value);

    // The marker, the strip and the live preview follow.
    await expect(marker(panel)).toHaveAttribute("data-focus-x", String(focus.x));
    const expectedStyle = `${Number((focus.x * 100).toFixed(1))}% ${Number((focus.y * 100).toFixed(1))}%`;
    await expect.poll(() => positionOf(strip(panel).locator("img"))).toBe(expectedStyle);
    await showView(page, "Preview");
    await expect(previewScreen(page).locator(`[data-block-id="${ids.image}"] img`)).toHaveCSS(
      "object-position",
      expectedStyle,
    );
    await showView(page, "Blocks");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    await expect(live(panel)).toHaveText(
      `Focus ${Math.round(focus.x * 100)} percent across, ${Math.round(focus.y * 100)} percent down`,
    );

    // Center removes the key.
    await centerButton(panel).click();
    await expectDraft(user.pageId, (d) => {
      const image = (d.blocks[0] as { image: Record<string, unknown> }).image;
      return !("focus" in image);
    });
    await expect(live(panel)).toHaveText("Focus 50 percent across, 50 percent down");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
  });

  test("M6-25 dragging the marker clamps to the picture, and the marker is a 44px square with the ink border", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "fp2");
    await openEditor(page);
    const panel = await openPanel(page, ids.card);
    const pic = picture(panel);
    const m = marker(panel);
    await expect(m).toBeVisible();

    await centerInView(pic);
    const mb = (await m.boundingBox())!;
    expect(Math.round(mb.width)).toBe(44);
    expect(Math.round(mb.height)).toBe(44);
    expect(await css(m, "border-top-left-radius")).toBe("6px");
    expect(await css(m, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(m, "border-top-color")).toBe("rgb(28, 27, 26)");
    await expect(m).toHaveAttribute("aria-label", "Focus point");

    // Starts at the center of the picture.
    const pb = (await pic.boundingBox())!;
    expect(mb.x + mb.width / 2).toBeCloseTo(pb.x + pb.width / 2, 0);
    expect(mb.y + mb.height / 2).toBeCloseTo(pb.y + pb.height / 2, 0);

    // Drag the marker out through the bottom-right corner: it stops on the corner.
    await page.mouse.move(mb.x + 22, mb.y + 22);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width * 0.8, pb.y + pb.height * 0.3, { steps: 4 });
    await page.mouse.move(pb.x + pb.width + 200, pb.y + pb.height + 200, { steps: 6 });
    await page.mouse.up();
    await expectDraft(user.pageId, (d) => {
      const f = (d.blocks[1] as { image: { focus?: { x: number; y: number } } }).image.focus;
      return f?.x === 1 && f?.y === 1;
    });
    const after = (await m.boundingBox())!;
    // The marker's center is on the picture's bottom-right corner, not beyond it.
    expect(after.x + after.width / 2).toBeCloseTo(pb.x + pb.width, 0);
    expect(after.y + after.height / 2).toBeCloseTo(pb.y + pb.height, 0);

    // And out through the top-left.
    await page.mouse.move(after.x + 22, after.y + 22);
    await page.mouse.down();
    await page.mouse.move(pb.x - 300, pb.y - 300, { steps: 8 });
    await page.mouse.up();
    await expectDraft(user.pageId, (d) => {
      const f = (d.blocks[1] as { image: { focus?: { x: number; y: number } } }).image.focus;
      return f?.x === 0 && f?.y === 0;
    });
  });

  test("M6-25 the marker is a focusable button: arrow keys move it by 5 percent, Shift by 1, and a live region says where it is", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "fp3");
    await openEditor(page);
    const panel = await openPanel(page, ids.card);
    const m = marker(panel);
    await m.focus();
    await expect(m).toBeFocused();
    await expect(live(panel)).toHaveText("Focus 50 percent across, 50 percent down");
    await expect(live(panel)).toHaveAttribute("aria-live", "polite");

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(live(panel)).toHaveText("Focus 30 percent across, 50 percent down");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect(live(panel)).toHaveText("Focus 30 percent across, 70 percent down");
    // Shift: one percent.
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(live(panel)).toHaveText("Focus 31 percent across, 68 percent down");
    await expectDraft(user.pageId, (d) => {
      const f = (d.blocks[1] as { image: { focus?: { x: number; y: number } } }).image.focus;
      return f?.x === 0.31 && f?.y === 0.68;
    });
    // The arrows stop at the edges.
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
    await expect(live(panel)).toHaveText("Focus 0 percent across, 68 percent down");
  });

  test("M6-25 replacing the image resets the focus; removing it removes the control", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "fp4");
    await openEditor(page);
    const panel = await openPanel(page, ids.card);
    await clickPicture(page, picture(panel), 0.1, 0.9);
    await expectDraft(user.pageId, (d) => {
      const image = (d.blocks[1] as { image: { focus?: unknown } }).image;
      return image.focus !== undefined;
    });
    const before = (await draftOfPage(user.pageId)).blocks[1] as { image: { path: string } };

    await panel.locator('input[type="file"]').setInputFiles({
      name: "other.png",
      mimeType: "image/png",
      buffer: await halves(900, 300, { split: "tb" }),
    });
    const next = await expectDraft(user.pageId, (d) => {
      const image = (d.blocks[1] as { image: { path: string } }).image;
      return image.path !== before.image.path;
    });
    const image = (next.blocks[1] as { image: Record<string, unknown> }).image;
    expect("focus" in image).toBe(false);
    await expect(live(panel)).toHaveText("Focus 50 percent across, 50 percent down");

    await panel.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(picker(panel)).toHaveCount(0);
  });

  test("M6-25 a Publish error shows under the Shape and Focus fields, opens the block and focuses the invalid control", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "fp5");
    const draft = await draftOfPage(user.pageId);
    const blocks = draft.blocks as unknown as Array<
      Record<string, unknown> & { image: Record<string, unknown> }
    >;
    blocks[0] = {
      ...blocks[0],
      shape: 'x"><b>',
      image: { ...blocks[0]!.image, focus: { x: 5, y: "a" } },
    };
    blocks[1] = { ...blocks[1], image: { ...blocks[1]!.image, focus: { x: null, y: 0.5 } } };
    await setDraft(user.pageId, { ...draft, blocks });

    await openEditor(page);
    await publishButton(page).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Fix 2 blocks before publishing." }),
    ).toBeVisible();

    const imagePanel = panelFor(page, ids.image);
    await expect(imagePanel).toBeVisible();
    await expect(imagePanel.getByText(SHAPE_SENTENCE)).toBeVisible();
    await expect(shapeSelect(imagePanel)).toHaveAttribute("aria-invalid", "true");
    // The first invalid control takes focus.
    await expect(shapeSelect(imagePanel)).toBeFocused();
    // The select shows that no real shape is chosen, and a real one fixes it.
    await shapeSelect(imagePanel).selectOption("wide");
    await expect(imagePanel.getByText(SHAPE_SENTENCE)).toHaveCount(0);
    // The focus error is under the Focus control (shown now that the shape is valid).
    await expect(imagePanel.getByText(FOCUS_SENTENCE)).toBeVisible();
    await expect(marker(imagePanel)).toHaveAttribute("aria-invalid", "true");
    await centerButton(imagePanel).click();
    await expect(imagePanel.getByText(FOCUS_SENTENCE)).toHaveCount(0);

    // The card: open it, the focus sentence and the marker flagged.
    const cardPanel = await openPanel(page, ids.card);
    await expect(cardPanel.getByText(FOCUS_SENTENCE)).toBeVisible();
    await expect(marker(cardPanel)).toHaveAttribute("aria-invalid", "true");

    // Nothing was published.
    await expect(statusChip(page)).not.toHaveAttribute("data-publish-status", "published");
  });

  test("M6-25 an Original-shape image with a focus the gate refused still shows the error; the marker takes focus and Center clears it", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "fp6");
    const draft = await draftOfPage(user.pageId);
    const blocks = draft.blocks as unknown as Array<
      Record<string, unknown> & { image: Record<string, unknown> }
    >;
    // No shape on the image block, and a focus outside the picture, written straight to the draft.
    blocks[0] = { ...blocks[0]!, image: { ...blocks[0]!.image, focus: { x: 5, y: 5 } } };
    await setDraft(user.pageId, { ...draft, blocks });

    await openEditor(page);
    await publishButton(page).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Fix 1 block before publishing." }),
    ).toBeVisible();
    const imagePanel = panelFor(page, ids.image);
    await expect(imagePanel).toBeVisible();
    await expect(shapeSelect(imagePanel)).toHaveValue("original");
    await expect(imagePanel.getByText(FOCUS_SENTENCE)).toBeVisible();
    await expect(marker(imagePanel)).toHaveAttribute("aria-invalid", "true");
    await expect(marker(imagePanel)).toBeFocused();
    await centerButton(imagePanel).click();
    await expect(imagePanel.getByText(FOCUS_SENTENCE)).toHaveCount(0);
    await expectDraft(user.pageId, (d) => {
      const image = (d.blocks[0] as { image: Record<string, unknown> }).image;
      return !("focus" in image);
    });
  });
});

const panelFor = (page: Page, id: string) => page.locator(`#block-panel-${id}`);

test.describe("M6-25 layout", () => {
  test("M6-25 phone: the picker is full width, the picture is at most 240px tall, the controls are 44px, no sideways scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await setup(context, "fl1");
    await openEditor(page);
    const panel = await openPanel(page, ids.card);
    const area = panel.getByTestId("focus-picker-area");
    await expect(area).toBeVisible();
    const pa = (await area.boundingBox())!;
    const form = (await panel.boundingBox())!;
    // Full width: the picker spans the panel's content.
    expect(pa.width).toBeGreaterThan(form.width - 60);
    const pic = (await picture(panel).boundingBox())!;
    expect(pic.height).toBeLessThanOrEqual(240.5);
    expect((await marker(panel).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await centerButton(panel).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The picture alone stops page scrolling (touch-action: none); the picker area does not.
    expect(await css(picture(panel), "touch-action")).toBe("none");
    expect(await css(area, "touch-action")).toBe("auto");
    // Phone: the strip sits below the picker.
    const strip_ = (await strip(panel).boundingBox())!;
    expect(strip_.y).toBeGreaterThan(pa.y + pa.height - 1);
    // The strip is the card banner's 5:2.
    expect(strip_.width / strip_.height).toBeCloseTo(2.5, 1);
    await expectNoHorizontalScroll(page);

    const imagePanel = await openPanel(page, ids.image);
    await shapeSelect(imagePanel).selectOption("square");
    const sb = (await strip(imagePanel).boundingBox())!;
    expect(sb.width / sb.height).toBeCloseTo(1, 1);
    expect((await shapeSelect(imagePanel).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
  });

  test("M6-25 desktop: the picker and the 'How it will look' strip sit side by side in a column of at most 720px", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await setup(context, "fl2");
    await openEditor(page);
    const panel = await openPanel(page, ids.card);
    const area = (await panel.getByTestId("focus-picker-area").boundingBox())!;
    const stripBox = (await strip(panel).boundingBox())!;
    expect(stripBox.x).toBeGreaterThan(area.x + area.width - 1);
    expect(Math.abs(stripBox.y - area.y)).toBeLessThan(40);
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(720);
    await expect(panel.getByText("How it will look")).toBeVisible();
    await panel.screenshot({ path: "tmp/screens/m6-focus-picker-desktop.png" });
  });
});
