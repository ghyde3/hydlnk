import { expect, test, type Page, type Request } from "@playwright/test";
import sharp from "sharp";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, expectDraft, openEditor, pageRow, previewScreen } from "../m2/editor-helpers";
import {
  UNREADABLE_IMAGE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
} from "@/lib/media/messages";
import { downloadObject, halves, isBlue, isRed, pixelAt } from "./images-helpers";
import { inPreviewSheet } from "../m7/phone-preview";

/**
 * M6-24: choosing a profile photo opens "Position your photo" first; only what "Use photo" draws is
 * uploaded. Each test makes its own user (the phone and desktop projects run at once) and watches
 * the network, so "nothing was uploaded" is a statement about POST /api/media itself.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const card = (page: Page) => page.getByTestId("profile-card");
// The Profile card holds two uploads since M9-24 (the photo and the logo): the photo's is in its own row.
const fileInput = (page: Page) =>
  card(page).getByTestId("profile-photo-row").locator('input[type="file"]');
const dialog = (page: Page) => page.getByRole("dialog", { name: "Position your photo" });
const finder = (page: Page) => page.getByTestId("position-viewfinder");
const picture = (page: Page) => page.getByTestId("position-picture");
const slider = (page: Page) => dialog(page).getByRole("slider", { name: "Zoom" });
const useButton = (page: Page) =>
  dialog(page).getByRole("button", { name: "Use photo", exact: true });
const cancelButton = (page: Page) =>
  dialog(page).getByRole("button", { name: "Cancel", exact: true });
const resetButton = (page: Page) =>
  dialog(page).getByRole("button", { name: "Reset", exact: true });
const uploadButton = (page: Page) =>
  card(page).getByRole("button", { name: /^(Upload|Replace) photo$|^Uploading\.\.\.$/ });
const avatarImg = (page: Page) =>
  card(page)
    .getByRole("img", { name: /^Profile photo/ })
    .locator("img");

/**
 * Every POST /api/media the page makes. The request bodies are not readable from here (they are
 * multipart streams), so a script in the page also records what was handed to `fetch`: the file's
 * type and size and the `kind` field (`uploadedFiles`).
 */
function watchUploads(page: Page): Request[] {
  const posts: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/media") {
      posts.push(request);
    }
  });
  void page.addInitScript(() => {
    const w = window as unknown as { __hlUploads: unknown[] };
    w.__hlUploads = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const body = init?.body;
      if (url.endsWith("/api/media") && body instanceof FormData) {
        const file = body.get("file");
        w.__hlUploads.push({
          kind: body.get("kind"),
          type: file instanceof File ? file.type : null,
          size: file instanceof File ? file.size : null,
          name: file instanceof File ? file.name : null,
        });
      }
      return original(input, init);
    };
  });
  return posts;
}

interface UploadedFile {
  kind: string | null;
  type: string | null;
  size: number | null;
  name: string | null;
}

const uploadedFiles = (page: Page): Promise<UploadedFile[]> =>
  page.evaluate(() => (window as unknown as { __hlUploads: UploadedFile[] }).__hlUploads);

const png = (name: string, buffer: Buffer) => ({ name, mimeType: "image/png", buffer });

async function setup(context: import("@playwright/test").BrowserContext, label: string) {
  return emptyUser(context, label);
}

/** Picks a PNG and waits for the dialog. */
async function pick(page: Page, buffer: Buffer, name = "photo.png") {
  await fileInput(page).setInputFiles(png(name, buffer));
  await expect(dialog(page)).toBeVisible();
  // The viewfinder is ready once react-easy-crop has measured the picture (M9-08). A drag before that
  // is clamped to an unmeasured picture, which a busy machine shows as a wrong crop.
  await expect(finder(page)).toHaveAttribute("data-ready", "true");
}

/** The stored avatar the draft names, with its path. */
async function storedAvatar(pageId: string) {
  const draft = await expectDraft(pageId, (d) => d.profile.photo !== null, "the draft's photo");
  const path = draft.profile.photo!.path;
  return { path, bytes: await downloadObject(path), draft };
}

test.describe("M6-24 choosing a file", () => {
  test("M6-24 a text file renamed .jpg is refused before any dialog, with no upload", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd1");
    const posts = watchUploads(page);
    await openEditor(page);
    await fileInput(page).setInputFiles({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("this is not a picture, just words\n".repeat(20)),
    });
    await expect(card(page).getByRole("alert")).toHaveText(UNSUPPORTED_TYPE_MESSAGE);
    expect(UNSUPPORTED_TYPE_MESSAGE).toBe("That file type isn’t supported. Use JPEG, PNG or WebP.");
    await expect(dialog(page)).toHaveCount(0);
    expect(posts).toHaveLength(0);
    expect((await pageRow(user.pageId)).draft.profile.photo).toBeNull();
  });

  test("M6-24 a picture the browser cannot decode opens no dialog and uploads nothing", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd2");
    const posts = watchUploads(page);
    await openEditor(page);
    // The PNG signature and nothing after it: the type check passes, the decode cannot.
    const broken = (await halves(40, 40)).subarray(0, 33);
    await fileInput(page).setInputFiles(png("broken.png", broken));
    await expect(card(page).getByRole("alert")).toHaveText(UNREADABLE_IMAGE_MESSAGE);
    await expect(dialog(page)).toHaveCount(0);
    await expect(uploadButton(page)).toBeEnabled();
    expect(posts).toHaveLength(0);
    expect((await pageRow(user.pageId)).draft.profile.photo).toBeNull();
  });

  test("M6-24 Upload photo no longer uploads at once: a dialog opens first", async ({
    page,
    context,
  }) => {
    await setup(context, "pd3");
    const posts = watchUploads(page);
    await openEditor(page);
    await expect(
      card(page).getByRole("button", { name: "Upload photo", exact: true }),
    ).toBeVisible();
    await pick(page, await halves(600, 400));
    await expect(card(page).getByRole("button", { name: "Adjust photo" })).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });
});

test.describe("M6-24 the dialog", () => {
  test("M6-24 a modal with a labelled title, a viewfinder with a circular outline, a 1x to 4x slider and three 44px buttons; Tab stays inside", async ({
    page,
    context,
  }) => {
    await setup(context, "pd4");
    await openEditor(page);
    await pick(page, await halves(600, 400));

    const modal = dialog(page);
    await expect(modal).toHaveAttribute("aria-modal", "true");
    await expect(modal.getByRole("heading", { name: "Position your photo" })).toBeVisible();
    const vf = finder(page);
    await expect(vf).toBeFocused();
    expect(await vf.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
    const outline = page.getByTestId("position-outline");
    expect(await outline.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toMatch(
      /^(50%|\d{4,}px|3.35544e\+07px)$/,
    );
    await expect(vf).toHaveAttribute("data-variant", "photo");

    const range = slider(page);
    await expect(range).toHaveAttribute("min", "1");
    await expect(range).toHaveAttribute("max", "4");
    expect((await range.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const button of [resetButton(page), cancelButton(page), useButton(page)]) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Primary is charcoal, the other two are secondary.
    expect(await useButton(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(28, 27, 26)",
    );
    expect(await cancelButton(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(255, 255, 255)",
    );
    expect(await resetButton(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(255, 255, 255)",
    );

    // Tab stays inside, forward and back.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
        true,
      );
    }
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
        true,
      );
    }
    // The page behind is inert: the Display name field cannot take focus.
    await page
      .getByLabel("Display name", { exact: true })
      .focus({ timeout: 500 })
      .catch(() => undefined);
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
      true,
    );
  });

  test("M6-24 the picture always covers the viewfinder, whatever is dragged or zoomed", async ({
    page,
    context,
  }) => {
    await setup(context, "pd5");
    await openEditor(page);
    await pick(page, await halves(900, 500));
    const covers = async (label: string) => {
      const v = (await finder(page).boundingBox())!;
      const p = (await picture(page).boundingBox())!;
      expect(p.x, `${label}: left edge`).toBeLessThanOrEqual(v.x + 0.6);
      expect(p.y, `${label}: top edge`).toBeLessThanOrEqual(v.y + 0.6);
      expect(p.x + p.width, `${label}: right edge`).toBeGreaterThanOrEqual(v.x + v.width - 0.6);
      expect(p.y + p.height, `${label}: bottom edge`).toBeGreaterThanOrEqual(v.y + v.height - 0.6);
    };
    await covers("opening");
    const v = (await finder(page).boundingBox())!;
    const cx = v.x + v.width / 2;
    const cy = v.y + v.height / 2;
    for (const [dx, dy] of [
      [400, 0],
      [-400, 0],
      [0, 400],
      [0, -400],
      [300, 300],
      [-300, -300],
    ] as const) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
      await page.mouse.up();
      await covers(`drag ${dx},${dy}`);
    }
    for (const zoom of ["1", "2.5", "4", "1.3"]) {
      await slider(page).fill(zoom);
      await covers(`zoom ${zoom}`);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 500, cy + 500, { steps: 4 });
      await page.mouse.up();
      await covers(`zoom ${zoom} then drag`);
    }
  });

  test("M6-24 keyboard: arrows move the picture 10px (Shift 1px), plus and minus zoom, a live region says the zoom; Escape cancels and returns focus", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd6");
    const posts = watchUploads(page);
    await openEditor(page);
    await pick(page, await halves(900, 900));
    const live = page.getByTestId("position-live");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toHaveText("Zoom 100 percent");

    await slider(page).fill("2");
    await expect(live).toHaveText("Zoom 200 percent");
    await finder(page).focus();

    const left = async () => (await picture(page).boundingBox())!.x;
    const top = async () => (await picture(page).boundingBox())!.y;
    const x0 = await left();
    await page.keyboard.press("ArrowLeft");
    expect(x0 - (await left())).toBeCloseTo(10, 0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // Moving the picture right, away from the left edge, is limited by the cover rule: it cannot
    // go past where it started at the center, so one more nudge may be clamped. Check Shift on the
    // vertical axis, which has room both ways.
    const y0 = await top();
    await page.keyboard.press("Shift+ArrowUp");
    expect(y0 - (await top())).toBeCloseTo(1, 0);
    await page.keyboard.press("ArrowUp");
    expect(y0 - 1 - (await top())).toBeCloseTo(10, 0);

    await page.keyboard.press("+");
    await expect(live).toHaveText("Zoom 225 percent");
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    await expect(live).toHaveText("Zoom 175 percent");
    await page.keyboard.press("=");
    await expect(live).toHaveText("Zoom 200 percent");

    // Escape is Cancel: closes, nothing uploaded, focus back on the button that opened it.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(uploadButton(page)).toBeFocused();
    expect(posts).toHaveLength(0);
    expect((await pageRow(user.pageId)).draft.profile.photo).toBeNull();
  });

  test("M6-24 Reset puts the picture back; Cancel closes without uploading", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd7");
    const posts = watchUploads(page);
    await openEditor(page);
    await pick(page, await halves(900, 600));
    const before = await picture(page).boundingBox();
    await slider(page).fill("3");
    await finder(page).focus();
    await page.keyboard.press("ArrowLeft");
    expect(await picture(page).boundingBox()).not.toEqual(before);
    await resetButton(page).click();
    expect(await picture(page).boundingBox()).toEqual(before);
    await expect(slider(page)).toHaveValue("1");
    await cancelButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(uploadButton(page)).toBeFocused();
    // The page scrolls again once the dialog is gone.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    expect(posts).toHaveLength(0);
    expect((await pageRow(user.pageId)).draft.profile.photo).toBeNull();
  });
});

test.describe("M6-24 Use photo", () => {
  test("M6-24 dragging so only the blue half is inside gives a blue avatar; the button says Uploading... until it appears", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd8");
    const posts = watchUploads(page);
    // Slow the upload so the busy state can be seen.
    await page.route("**/api/media", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });
    await openEditor(page);
    await pick(page, await halves(600, 600));
    await slider(page).fill("2");
    const v = (await finder(page).boundingBox())!;
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.down();
    await page.mouse.move(v.x - 300, v.y + v.height / 2, { steps: 6 });
    await page.mouse.up();

    await useButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: "Uploading..." })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    expect(posts).toHaveLength(1);

    const { path, bytes } = await storedAvatar(user.pageId);
    expect(path).toMatch(new RegExp(`^${user.id}/avatar-[0-9a-f]{32}\\.webp$`));
    expect(bytes.length).toBeLessThanOrEqual(100 * 1024);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([300, 300, "webp"]);
    for (const [x, y] of [
      [150, 150],
      [20, 20],
      [280, 280],
      [20, 280],
      [280, 20],
    ] as const) {
      expect(isBlue(await pixelAt(bytes, x, y)), `pixel ${x},${y}`).toBe(true);
    }
    // The editor's avatar and the live preview both show that file.
    await expect(avatarImg(page)).toHaveAttribute("src", new RegExp(`${path}$`));
    await inPreviewSheet(page, () =>
      expect(
        previewScreen(page).locator(".pg-avatar img, img.pg-avatar-img").first(),
      ).toHaveAttribute("src", new RegExp(`${path}$`)),
    );
  });

  test("M6-24 the left half in view gives a red avatar, and the request is the cropped JPEG, never the original", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd9");
    const posts = watchUploads(page);
    await openEditor(page);
    await pick(page, await halves(1200, 1200));
    await slider(page).fill("2");
    const v = (await finder(page).boundingBox())!;
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.down();
    await page.mouse.move(v.x + 600, v.y + v.height / 2, { steps: 6 });
    await page.mouse.up();
    await useButton(page).click();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    const { bytes } = await storedAvatar(user.pageId);
    expect(isRed(await pixelAt(bytes, 200, 200))).toBe(true);
    expect(posts).toHaveLength(1);
    const [sent] = await uploadedFiles(page);
    expect(sent).toMatchObject({ kind: "avatar", type: "image/jpeg" });
    expect(sent!.name).toMatch(/\.jpg$/);
    // The crop is 600 x 600 of the 1200 x 1200 source, as a small JPEG.
    expect(sent!.size!).toBeLessThan(60 * 1024);
  });

  test("M6-24 a PNG with transparency goes out as a PNG", async ({ page, context }) => {
    const user = await setup(context, "pd10");
    const posts = watchUploads(page);
    await openEditor(page);
    const seeThrough = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 20, g: 20, b: 230, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    await pick(page, seeThrough);
    await useButton(page).click();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(await uploadedFiles(page)).toMatchObject([{ kind: "avatar", type: "image/png" }]);
    const { bytes } = await storedAvatar(user.pageId);
    const meta = await sharp(bytes).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  test("M6-24 a 6000 x 4000 phone JPEG with EXIF orientation 6 is upright in the dialog and arrives as a small JPEG", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const user = await setup(context, "pd11");
    const posts = watchUploads(page);
    await openEditor(page);
    const big = await halves(6000, 4000, { format: "jpeg", orientation: 6 });
    await fileInput(page).setInputFiles({
      name: "IMG_0001.jpg",
      mimeType: "image/jpeg",
      buffer: big,
    });
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
    // Upright: the dialog's picture is 4000 wide and 6000 tall (the file stores 6000 x 4000).
    const natural = await picture(page).evaluate((el) => [
      (el as HTMLImageElement).naturalWidth,
      (el as HTMLImageElement).naturalHeight,
    ]);
    expect(natural).toEqual([4000, 6000]);
    await useButton(page).click();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible({
      timeout: 30_000,
    });
    expect(posts).toHaveLength(1);
    const [sent] = await uploadedFiles(page);
    expect(sent).toMatchObject({ kind: "avatar", type: "image/jpeg" });
    expect(sent!.size!).toBeLessThan(1024 * 1024);
    const { bytes } = await storedAvatar(user.pageId);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([400, 400]);
    // Raw left = red turns into the top: the avatar is red above and blue below, not left and right.
    expect(isRed(await pixelAt(bytes, 200, 40))).toBe(true);
    expect(isBlue(await pixelAt(bytes, 200, 360))).toBe(true);
    expect(isRed(await pixelAt(bytes, 40, 200)) && isBlue(await pixelAt(bytes, 360, 200))).toBe(
      false,
    );
  });

  test("M6-24 an upload that fails after Use photo shows the sentence under the buttons and keeps the old photo", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd12");
    await openEditor(page);
    await pick(page, await halves(500, 500));
    await useButton(page).click();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    const { path } = await storedAvatar(user.pageId);

    await page.route("**/api/media", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "retry-after": "60" },
        body: JSON.stringify({ error: "rate_limited", message: RATE_LIMITED_MESSAGE }),
      }),
    );
    await pick(page, await halves(700, 500, { split: "tb" }));
    await useButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(card(page).getByRole("alert")).toHaveText(RATE_LIMITED_MESSAGE);
    await expect(avatarImg(page)).toHaveAttribute("src", new RegExp(`${path}$`));
    expect((await pageRow(user.pageId)).draft.profile.photo!.path).toBe(path);
  });
});

test.describe("M6-24 Adjust photo", () => {
  test("M6-24 Adjust photo appears with a photo, reopens the dialog on the stored picture and stores a new object; the live page keeps the old photo", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd13");
    const posts = watchUploads(page);
    await openEditor(page);
    await expect(card(page).getByRole("button", { name: /^Adjust photo/ })).toHaveCount(0);
    await pick(page, await halves(600, 600));
    await useButton(page).click();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    const first = await storedAvatar(user.pageId);

    const adjust = card(page).getByRole("button", { name: "Adjust photo", exact: true });
    await expect(adjust).toBeVisible();
    expect((await adjust.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await adjust.click();
    await expect(dialog(page)).toBeVisible();
    const natural = await picture(page).evaluate((el) => [
      (el as HTMLImageElement).naturalWidth,
      (el as HTMLImageElement).naturalHeight,
    ]);
    expect(natural).toEqual([400, 400]);
    await slider(page).fill("2");
    await useButton(page).click();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    await expect
      .poll(async () => (await pageRow(user.pageId)).draft.profile.photo?.path)
      .not.toBe(first.path);
    expect(posts).toHaveLength(2);
    const second = await storedAvatar(user.pageId);
    expect(second.path).not.toBe(first.path);
    expect(second.path).toMatch(/\/avatar-[0-9a-f]{32}\.webp$/);
    // Nothing is published: the live page (the published column) does not hold either photo.
    const row = await pageRow(user.pageId);
    expect(row.published).toBeNull();
  });

  test("M6-24 when the stored picture cannot be read, the dialog does not open and a sentence says what to do", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "pd14");
    await openEditor(page);
    await pick(page, await halves(500, 500));
    await useButton(page).click();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    await storedAvatar(user.pageId);

    // "Adjust photo" reads the stored picture from this host's /media route (M7-15).
    await page.route(/\/media\/[0-9a-f-]{36}\//, (route) => route.abort());
    await card(page).getByRole("button", { name: "Adjust photo", exact: true }).click();
    await expect(card(page).getByRole("alert")).toHaveText(
      "We couldn’t open that photo. Choose it again with Replace photo.",
    );
    await expect(dialog(page)).toHaveCount(0);
    expect((await pageRow(user.pageId)).draft.profile.photo).not.toBeNull();
  });
});

test.describe("M6-24 layout", () => {
  test("M6-24 phone: a full-height sheet with Cancel and Use photo pinned at the bottom; dragging does not scroll the page", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await setup(context, "pl1");
    await openEditor(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await pick(page, await halves(800, 500));

    const sheet = (await dialog(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.round(sheet.x)).toBe(0);
    expect(Math.round(sheet.y)).toBe(0);
    expect(Math.round(sheet.width)).toBe(viewport.width);
    expect(Math.round(sheet.height)).toBe(viewport.height);
    const use = (await useButton(page).boundingBox())!;
    const cancel = (await cancelButton(page).boundingBox())!;
    for (const button of [use, cancel]) {
      expect(button.height).toBeGreaterThanOrEqual(44);
      // Pinned: the bottom edge sits within the sheet's bottom padding, above the inset.
      expect(viewport.height - (button.y + button.height)).toBeLessThanOrEqual(24);
    }
    for (const control of [slider(page), resetButton(page)]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Dragging the picture does not scroll the page behind it.
    const v = (await finder(page).boundingBox())!;
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.down();
    await page.mouse.move(v.x + v.width / 2 - 80, v.y + v.height / 2 - 120, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
      "hidden",
    );
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "tmp/screens/m6-position-dialog-phone.png" });
  });

  test("M6-24 desktop: centered, about 440px wide, over a dimmed page that does not scroll; the viewfinder is 280px square", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await setup(context, "pl2");
    await openEditor(page);
    // The editor page scrolls, so "does not scroll" means something. (The Edit tab's collapsed
    // Profile card, M7-03, can leave a page shorter than the screen, so the page is made taller.)
    await page.evaluate(() => (document.documentElement.style.minHeight = "2400px"));
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(true);
    await pick(page, await halves(800, 500));

    const box = (await dialog(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.abs(box.width - 440)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
    const v = (await finder(page).boundingBox())!;
    expect(Math.round(v.width)).toBe(280);
    expect(Math.round(v.height)).toBe(280);

    // The page behind does not scroll, with the wheel over the backdrop or anywhere else.
    await page.mouse.move(60, 400);
    await page.mouse.wheel(0, 600);
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The backdrop dims the page.
    expect(
      await dialog(page).evaluate((el) => getComputedStyle(el, "::backdrop").backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await page.screenshot({ path: "tmp/screens/m6-position-dialog-desktop.png" });
  });
});

test("M6-24 the avatar shape on the page is still a CSS crop of the square image", async ({
  page,
  context,
}) => {
  const user = await setup(context, "pd15");
  await openEditor(page);
  await pick(page, await halves(700, 500));
  await useButton(page).click();
  await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
  await storedAvatar(user.pageId);
  const draft = (await pageRow(user.pageId)).draft;
  // No crop or focus value is stored for the photo: exactly path, width and height.
  expect(Object.keys(draft.profile.photo!).sort()).toEqual(["height", "path", "width"]);
});
