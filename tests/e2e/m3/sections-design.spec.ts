import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { openEditor, pageRow, seededUser, setDraft, statusChip } from "../m2/editor-helpers";
import { SERVER_PORT, padTo } from "../m2/publish-helpers";
import { makeJpeg } from "../m5/images-fixtures";
import {
  expectOverrides,
  isPhone,
  openDesign,
  previewRoot,
  reloadDesign,
  saveStatus,
  showPreview,
  showTokens,
} from "./design-helpers";

/** The canonical media origin: every uploaded image loads from the root host (M7-15). */
const MEDIA_ORIGIN = `http://localhost:${SERVER_PORT}`;

/**
 * M3-11 .. M3-16: the shape, spacing and background sections of the Design screen, one flow per
 * section at 390x844 and 1440x900: the options render with aria-pressed, a choice reaches the
 * preview and autosaves, survives a reload, and reaches the public page only after Publish.
 * (Computed styles of every option are in sections-live.spec.ts; the direct-API checks on the
 * image bucket are in sections-media.spec.ts.)
 */

// Publish runs a Server Action and an upload on a dev server that other suites share: allow time.
test.describe.configure({ timeout: 120_000 });

const uploaded: string[] = [];

test.afterAll(async () => {
  const paths = uploaded.splice(0);
  if (paths.length > 0) await adminClient().storage.from("page-media").remove(paths);
  await cleanupUsers();
});

const SMOKE = "00000000-0000-4000-8000-000000000003";
const MIB = 1024 * 1024;
const LINK = "Qw8vC2nKd4Ly"; // mara's link without its own style

const group = (page: Page, name: string): Locator => page.getByRole("group", { name, exact: true });
const option = (page: Page, groupName: string, name: string): Locator =>
  group(page, groupName).getByRole("button", { name, exact: true });
const pressedIn = (page: Page, groupName: string): Locator =>
  group(page, groupName).locator("button[aria-pressed=true]");

async function choose(page: Page, groupName: string, name: string): Promise<void> {
  await option(page, groupName, name).click();
  await expect(option(page, groupName, name)).toHaveAttribute("aria-pressed", "true");
}

const computed = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/**
 * Runs `read` against the preview. On a phone the preview is the mini phone's full-size sheet
 * (M7-09): it is opened for the read and closed again, so the controls behind it can be used.
 */
async function inPreview<T>(page: Page, read: () => Promise<T>): Promise<T> {
  await showPreview(page);
  try {
    return await read();
  } finally {
    await showTokens(page);
  }
}

/**
 * What a browser computes for a background image served from `/media` on the canonical root origin (M7-15):
 * the stored form is the Storage URL, the address drawn is `/media/{path}`.
 */
const mediaCss = (_page: Page, stored: string): string =>
  `url("${MEDIA_ORIGIN}/media/${stored.split("/page-media/")[1]}")`;

/** Every option of the named groups is at least 44px tall on a phone and nothing scrolls sideways. */
async function expectPhoneFit(page: Page, ...groups: string[]): Promise<void> {
  await expectNoHorizontalScroll(page);
  if (!isPhone(page)) return;
  for (const name of groups) {
    for (const button of await group(page, name).getByRole("button").all()) {
      expect((await button.boundingBox())!.height, `${name} option`).toBeGreaterThanOrEqual(44);
    }
  }
}

/** Publishes from the editor and waits for the "Published" chip. */
async function publish(page: Page): Promise<void> {
  await openEditor(page);
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published");
}

async function livePage(page: Page, handle: string): Promise<Page> {
  const live = await page.context().newPage();
  await live.goto(url(handle));
  return live;
}

// ------------------------------------------------------------------------------------------------

test.describe("M3-11 / M3-12 shape section", () => {
  test("M3-11 / M3-12 button style, corner radius and border width: pressed states, preview, autosave, reload, Publish", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "shp");
    await openDesign(page);

    // The groups render, one option pressed in each, and it is Noir's.
    await expect(group(page, "Button style").getByRole("button")).toHaveText([
      "Fill",
      "Outline",
      "Soft",
      "Shadow",
      "Pill",
    ]);
    await expect(pressedIn(page, "Button style")).toHaveCount(1);
    await expect(pressedIn(page, "Button style")).toHaveText("Outline");
    await expect(pressedIn(page, "Corner radius")).toHaveText("12px");
    await expect(pressedIn(page, "Border thickness")).toHaveText("1px");
    await expectPhoneFit(page, "Button style", "Corner radius", "Border thickness");

    // The public page, cached before any change: outline buttons, 12px.
    const live = await livePage(page, user.handle);
    const liveLink = live.locator(`[data-block-id="${LINK}"]`);
    await expect(liveLink).toHaveAttribute("data-button-style", "outline");

    await choose(page, "Button style", "Soft");
    await choose(page, "Corner radius", "20px");
    await choose(page, "Border thickness", "2px");
    await expect(pressedIn(page, "Button style")).toHaveCount(1);

    // The preview follows at once.
    await inPreview(page, async () => {
      const previewLink = previewRoot(page).locator(`[data-block-id="${LINK}"]`);
      await expect(previewLink).toHaveAttribute("data-button-style", "soft");
      expect(await computed(previewLink, "border-top-left-radius")).toBe("20px");
      expect(
        await computed(previewRoot(page).locator("[data-block-type=card]"), "border-top-width"),
      ).toBe("2px");
      // A link with its own style keeps it.
      await expect(previewRoot(page).locator('[data-block-id="Bt5rJ1fGz6Os"]')).toHaveAttribute(
        "data-button-style",
        "fill",
      );
    });

    // Autosaved as page-level overrides, and still there after a reload.
    await expectOverrides(
      user.pageId,
      (o) => o.buttonStyle === "soft" && o.radius === 20 && o.borderWidth === 2,
    );
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", /saved|idle/);
    await reloadDesign(page);
    await expect(pressedIn(page, "Button style")).toHaveText("Soft");
    await expect(pressedIn(page, "Corner radius")).toHaveText("20px");
    await expect(pressedIn(page, "Border thickness")).toHaveText("2px");

    // Not on the live page until Publish.
    await live.reload();
    await expect(liveLink).toHaveAttribute("data-button-style", "outline");
    expect(await computed(liveLink, "border-top-left-radius")).toBe("12px");
    await publish(page);
    await live.reload();
    await expect(liveLink).toHaveAttribute("data-button-style", "soft");
    expect(await computed(liveLink, "border-top-left-radius")).toBe("20px");
    await expectNoHorizontalScroll(live);
    await live.close();
  });
});

test.describe("M3-13 spacing section", () => {
  test("M3-13 density, content width and alignment: pressed states, preview, autosave, reload, Publish", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "spc");
    await openDesign(page);

    await expect(group(page, "Space between blocks").getByRole("button")).toHaveText([
      "Compact",
      "Regular",
      "Airy",
    ]);
    await expect(group(page, "Page width").getByRole("button")).toHaveText(["480", "560", "640"]);
    await expect(group(page, "Text alignment").getByRole("button")).toHaveText(["Center", "Left"]);
    await expect(pressedIn(page, "Space between blocks")).toHaveText("Regular");
    await expect(pressedIn(page, "Page width")).toHaveText("480");
    await expect(pressedIn(page, "Text alignment")).toHaveText("Center");
    await expectPhoneFit(page, "Space between blocks", "Page width", "Text alignment");

    const live = await livePage(page, user.handle);
    const gap = (target: Locator) => computed(target.locator("main"), "row-gap");
    expect(await gap(live.locator("body"))).toBe("12px");

    await choose(page, "Space between blocks", "Airy");
    await choose(page, "Page width", "640");
    await choose(page, "Text alignment", "Left");

    // The preview: 18px between blocks, left-aligned headings.
    await inPreview(page, async () => {
      expect(await gap(previewRoot(page))).toBe("18px");
      expect(await computed(previewRoot(page).locator("h2").first(), "text-align")).toBe("left");
    });

    await expectOverrides(
      user.pageId,
      (o) => o.density === "airy" && o.maxWidth === 640 && o.align === "left",
    );
    await reloadDesign(page);
    await expect(pressedIn(page, "Space between blocks")).toHaveText("Airy");
    await expect(pressedIn(page, "Page width")).toHaveText("640");
    await expect(pressedIn(page, "Text alignment")).toHaveText("Left");

    // Not live until Publish; then 18px, a 640px column on desktop, left alignment.
    await live.reload();
    expect(await gap(live.locator("body"))).toBe("12px");
    await publish(page);
    await live.reload();
    expect(await gap(live.locator("body"))).toBe("18px");
    expect(await computed(live.locator("h2[data-block-type=header]"), "text-align")).toBe("left");
    const column = (await live.locator("[data-page-root] > div").first().boundingBox())!;
    if (info.project.name === "desktop") expect(column.width).toBe(640);
    else expect(column.width).toBeLessThanOrEqual(390);
    await expectNoHorizontalScroll(live);
    await live.close();
  });
});

test.describe("M3-14 solid and gradient", () => {
  test("M3-14 the Smoke theme shows the gradient; Solid autosaves and reaches the live page only after Publish", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bgg");
    // Smoke applied to the draft (the themes card is another area's: this is its effect).
    const draft = (await pageRow(user.pageId)).draft;
    await setDraft(user.pageId, { ...draft, theme: { ref: SMOKE, overrides: {} } });
    await openDesign(page);

    await expect(group(page, "Background").getByRole("button")).toHaveText([
      "Solid",
      "Gradient",
      "Image…",
    ]);
    await expect(pressedIn(page, "Background")).toHaveText("Gradient");
    await inPreview(page, async () => {
      await expect(previewRoot(page)).toHaveAttribute("data-bg-type", "gradient");
      expect(await computed(previewRoot(page), "background-image")).toMatch(/^linear-gradient\(/);
    });
    await expectPhoneFit(page, "Background");

    await publish(page);
    const live = await livePage(page, user.handle);
    await expect(live.locator("[data-page-root]")).toHaveAttribute("data-bg-type", "gradient");

    await openDesign(page);
    await choose(page, "Background", "Solid");
    await inPreview(page, async () => {
      await expect(previewRoot(page)).toHaveAttribute("data-bg-type", "solid");
      expect(await computed(previewRoot(page), "background-image")).toBe("none");
    });
    await expectOverrides(user.pageId, (o) => o.bgType === "solid");

    // The live page keeps the gradient until Publish.
    await live.reload();
    await expect(live.locator("[data-page-root]")).toHaveAttribute("data-bg-type", "gradient");
    await publish(page);
    await live.reload();
    await expect(live.locator("[data-page-root]")).toHaveAttribute("data-bg-type", "solid");

    // Gradient again: the choice survives a reload.
    await openDesign(page);
    await choose(page, "Background", "Gradient");
    await expectOverrides(user.pageId, (o) => o.bgType === "gradient");
    await reloadDesign(page);
    await expect(pressedIn(page, "Background")).toHaveText("Gradient");
    await live.close();
  });
});

// ------------------------------------------------------------------------------------------------

type PickedFile = { name: string; mimeType: string; buffer: Buffer };

/**
 * A real 1600x900 JPEG (the route decodes it, M5-12) whose colour comes from its name, so two names
 * are two different images with two different content-hash URLs; padded with zeros to `bytes` when
 * it is smaller (a JPEG ignores bytes after its end).
 */
const jpeg = async (name: string, bytes = 1.2 * MIB): Promise<PickedFile> => {
  const seed = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const photo = await makeJpeg({
    width: 1600,
    height: 900,
    color: [(seed * 53) % 256, (seed * 97 + 50) % 256, (seed * 29 + 100) % 256],
  });
  return { name, mimeType: "image/jpeg", buffer: padTo(photo, Math.round(bytes)) };
};

/** Picks a file the way the device does: the file chooser on desktop, the hidden input on a phone. */
async function pickFile(page: Page, file: PickedFile): Promise<void> {
  if (isPhone(page)) {
    await page.getByTestId("background-file").setInputFiles(file);
    return;
  }
  const chooser = page.waitForEvent("filechooser");
  await option(page, "Background", "Image…").click();
  await (await chooser).setFiles(file);
}

const storageUrl = (ownerId: string) =>
  new RegExp(
    `^${supabaseUrl()}/storage/v1/object/public/page-media/${ownerId}/bg-[0-9a-f]{32}\\.webp$`,
  );

const isMediaPost = (r: { url(): string; request(): { method(): string } }) =>
  r.url().endsWith("/api/media") && r.request().method() === "POST";

/** Uploads through the Design screen; returns the public URL the draft now stores. */
async function uploadBackground(
  page: Page,
  user: { userId: string; pageId: string },
  name: string,
  previous?: string,
): Promise<string> {
  const posted = page.waitForResponse(isMediaPost);
  await pickFile(page, await jpeg(name));
  expect((await posted).status()).toBe(200);
  const overrides = await expectOverrides(
    user.pageId,
    (o) =>
      o.bgType === "image" &&
      typeof o.bgImage === "string" &&
      storageUrl(user.userId).test(o.bgImage) &&
      o.bgImage !== previous,
    "the draft stores the uploaded image's public URL",
  );
  const stored = overrides.bgImage as string;
  uploaded.push(stored.split("/page-media/")[1]!);
  return stored;
}

const status = async (target: string) => (await fetch(target)).status;

test.describe("M3-15 / M3-16 background image", () => {
  test("M3-15 / M3-16 upload with progress, the layers in the preview, sliders, reload and Remove image", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bgi");
    await openDesign(page);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove image" })).toHaveCount(0);

    // Upload, slowed down so the progress shows.
    await page.route("**/api/media", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    const posted = page.waitForResponse(isMediaPost);
    await pickFile(page, await jpeg("a.jpg"));
    await expect(
      page.getByRole("progressbar", { name: "Uploading background image" }),
    ).toBeVisible();
    expect((await posted).status()).toBe(200);
    await page.unroute("**/api/media");
    const overrides = await expectOverrides(
      user.pageId,
      (o) => o.bgType === "image" && typeof o.bgImage === "string",
    );
    const imageA = overrides.bgImage as string;
    expect(imageA).toMatch(storageUrl(user.userId));
    uploaded.push(imageA.split("/page-media/")[1]!);
    await expect(page.getByRole("progressbar")).toHaveCount(0);

    // The preview draws it on its own layer; Image… is marked as the active type.
    await inPreview(page, async () => {
      await expect(previewRoot(page)).toHaveAttribute("data-bg-type", "image");
      expect(
        await computed(previewRoot(page).locator("[data-bg-layer=image]"), "background-image"),
      ).toBe(mediaCss(page, imageA));
    });
    await expect(option(page, "Background", "Image…")).toHaveAttribute("data-active", "true");
    await expect(pressedIn(page, "Background")).toHaveCount(0);
    const removeButton = page.getByRole("button", { name: "Remove image" });
    await expect(removeButton).toBeVisible();
    expect((await removeButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectPhoneFit(page, "Background");

    // M3-16: Overlay and Blur sliders: role slider, arrow keys, visible values, 44px touch height.
    const overlay = page.getByRole("slider", { name: "Image overlay" });
    const blur = page.getByRole("slider", { name: "Image blur" });
    await expect(overlay).toBeVisible();
    await expect(blur).toBeVisible();
    for (const slider of [overlay, blur]) {
      expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await overlay.focus();
    await page.keyboard.press("ArrowRight");
    await expect(overlay).toHaveValue("1");
    await overlay.fill("60");
    await blur.fill("12");
    await expect(overlay).toHaveAttribute("aria-valuetext", "60%");
    await expect(blur).toHaveAttribute("aria-valuetext", "12px");
    await expect(page.getByText("60%", { exact: true })).toBeVisible();
    await expect(page.getByText("12px", { exact: true }).last()).toBeVisible();
    await inPreview(page, async () => {
      const root = previewRoot(page);
      expect(await computed(root.locator("[data-bg-layer=overlay]"), "opacity")).toBe("0.6");
      expect(await computed(root.locator("[data-bg-layer=image]"), "filter")).toBe("blur(12px)");
      expect(await computed(root.locator(`[data-block-id="${LINK}"]`), "filter")).toBe("none");
    });
    await expectOverrides(user.pageId, (o) => o.overlayOpacity === 0.6 && o.blur === 12);
    await expectNoHorizontalScroll(page);

    // After a reload the image, sliders and values are all still there.
    await reloadDesign(page);
    await expect(page.getByRole("slider", { name: "Image overlay" })).toHaveValue("60");
    await expect(page.getByRole("slider", { name: "Image blur" })).toHaveValue("12");
    await inPreview(page, () => expect(previewRoot(page)).toHaveAttribute("data-bg-type", "image"));

    // Remove image: Solid, bgImage cleared, sliders gone. The object stays in Storage.
    await page.getByRole("button", { name: "Remove image" }).click();
    await expectOverrides(user.pageId, (o) => o.bgType === "solid" && o.bgImage === null);
    await inPreview(page, () => expect(previewRoot(page)).toHaveAttribute("data-bg-type", "solid"));
    await expect(page.getByRole("button", { name: "Remove image" })).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    expect(await status(imageA)).toBe(200);

    // A gradient has no sliders either.
    await choose(page, "Background", "Gradient");
    await expect(page.getByRole("slider")).toHaveCount(0);
  });

  test("M3-15 / M3-16 a published image stays live through replace and remove until the next Publish", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bgr");
    await openDesign(page);

    const imageA = await uploadBackground(page, user, "a.jpg");
    await page.getByRole("slider", { name: "Image overlay" }).fill("60");
    await page.getByRole("slider", { name: "Image blur" }).fill("12");
    await expectOverrides(user.pageId, (o) => o.overlayOpacity === 0.6 && o.blur === 12);
    await publish(page);

    // Live: the image, the 0.6 overlay and the 12px blur arrive with Publish; nothing scrolls.
    const live = await livePage(page, user.handle);
    const liveImage = live.locator("[data-bg-layer=image]");
    await expect(liveImage).toHaveCount(1);
    expect(await computed(liveImage, "background-image")).toBe(mediaCss(live, imageA));
    expect(await computed(liveImage, "filter")).toBe("blur(12px)");
    expect(await computed(live.locator("[data-bg-layer=overlay]"), "opacity")).toBe("0.6");
    await expectNoHorizontalScroll(live);

    // Replace in the draft: A is still in Storage and the live page still shows A.
    await openDesign(page);
    const imageB = await uploadBackground(page, user, "b.jpg", imageA);
    expect(imageB).not.toBe(imageA);
    expect(await status(imageA)).toBe(200);
    expect(await status(imageB)).toBe(200);
    await live.reload();
    expect(await computed(liveImage, "background-image")).toBe(mediaCss(live, imageA));

    // Remove in the draft: A is still served and still live.
    await page.getByRole("button", { name: "Remove image" }).click();
    await expectOverrides(user.pageId, (o) => o.bgImage === null && o.bgType === "solid");
    expect(await status(imageA)).toBe(200);
    await live.reload();
    expect(await computed(liveImage, "background-image")).toBe(mediaCss(live, imageA));

    // Upload again and Publish: now the live page shows the new image.
    await openDesign(page);
    const imageC = await uploadBackground(page, user, "c.jpg", imageB);
    await publish(page);
    await live.reload();
    expect(await computed(liveImage, "background-image")).toBe(mediaCss(live, imageC));
    // M5-14: A (what the live page showed until this Publish) and B (dropped from the draft, never
    // live) are referenced by nothing now, and the Publish action's cleanup deleted them. C is live.
    await expect.poll(() => status(imageA), { timeout: 15_000 }).not.toBe(200);
    await expect.poll(() => status(imageB), { timeout: 15_000 }).not.toBe(200);
    expect(await status(imageC)).toBe(200);
    expect(new Set([imageA, imageB, imageC]).size).toBe(3);
    await live.close();
  });

  test("M3-15 a .txt, .svg or .gif and a 5 MB JPEG show their message and store nothing", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bge");
    await openDesign(page);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/media")) posts.push(request.method());
    });
    const alert = page.getByRole("alert").filter({ hasText: /That (file|image)/ });
    const listing = async () =>
      ((await adminClient().storage.from("page-media").list(user.userId)).data ?? []).map(
        (item) => item.name,
      );
    const before = await listing();

    for (const file of [
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
      {
        name: "bg.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
      },
      {
        name: "bg.gif",
        mimeType: "image/gif",
        buffer: Buffer.from("R0lGODlhAQABAAAAACw=", "base64"),
      },
    ]) {
      await pickFile(page, file);
      await expect(alert).toHaveText("That file type isn’t supported. Use JPEG, PNG or WebP.");
    }
    // M5-12: a big JPEG the browser can read is downsized and sent; one it cannot read (a JPEG
    // header, then 5 MB of nothing) stays 5 MB and is refused before anything is sent.
    await pickFile(page, {
      name: "big.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * MIB, 7)]),
    });
    await expect(alert).toHaveText("That file is too big. Use an image under 4 MB.");

    await expectNoHorizontalScroll(page);
    expect(posts).toEqual([]);
    expect(await listing()).toEqual(before);
    const stored = (await pageRow(user.pageId)).draft.theme.overrides as Record<string, unknown>;
    expect(stored).not.toHaveProperty("bgImage");
  });
});
