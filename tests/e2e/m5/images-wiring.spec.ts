import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { expectDraft, openEditor, pageRow, seededUser, statusChip } from "../m2/editor-helpers";
import { addBlock } from "../m2/blocks-helpers";
import { confirmPhoto } from "../m6/position-dialog-helpers";
import { hidePreviewSheet, showPreviewSheet } from "../m7/phone-preview";
import { GIF, SERVER_PORT, tenantGet } from "../m2/publish-helpers";
import { computed, expectOverrides, isPhone, openDesign, previewRoot } from "../m3/design-helpers";
import {
  BUCKET,
  MIB,
  downloadObject,
  makeJpeg,
  makePngImage,
  objectExists,
  removeFolders,
} from "./images-helpers";

/** The canonical media origin: every uploaded image loads from the root host (M7-15). */
const MEDIA_ORIGIN = `http://localhost:${SERVER_PORT}`;

/**
 * M5-11, M5-12, M5-13, M5-14 in the editor and on the Design screen, at 390x844 and 1440x900: the
 * upload control downsizes a big photo in the browser, shows the route's own sentences inline, and
 * the draft stores the WebP the route made. The route itself is images-api.spec.ts; the cleanup
 * queue is images-cleanup.spec.ts. A fresh user per test: two contexts autosaving one draft would
 * trip the stale-tab guard.
 */

test.describe.configure({ timeout: 120_000 });

/**
 * The browser side of this feature lives in shared files that other Wave D agents are editing (the
 * upload control, the Design background control, the draft saver, the Publish action and the page
 * renderer): each is a few lines that import from src/lib/media. A test that needs one of those hooks
 * skips itself until the hook is in the tree, and runs by itself once it is.
 */
const source = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");
const UPLOAD_WIRED = source("src/components/editor/image-upload-control.tsx").includes(
  "prepareImageForUpload",
);
const DESIGN_WIRED = source("src/components/design/sections/background-section.tsx").includes(
  "prepareImageForUpload",
);
const PUBLISH_WIRED = source("src/lib/publish/actions.ts").includes("cleanupMediaQuietly");
const SAVE_WIRED = source("src/lib/editor/save-client.ts").includes("scheduleMediaCleanup");
const RENDER_WIRED = source("src/components/page/profile.tsx").includes('decoding="async"');
const NOT_WIRED = "needs the shared-file hook from src/lib/media (see the Wave D image notes)";

const owners: string[] = [];
test.afterAll(async () => {
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});

const card = (page: Page) => page.getByRole("region", { name: "Profile", exact: true });
const avatar = (page: Page) => card(page).getByRole("img", { name: /^Profile photo/ });
// The Profile card holds two uploads since M9-24 (the photo and the logo): the photo's is in its own row.
const fileInput = (page: Page) =>
  card(page).getByTestId("profile-photo-row").locator("input[type=file]");
const uploadButton = (page: Page) =>
  card(page).getByRole("button", { name: /^(Upload|Replace) photo|^Uploading/ });

const isMediaPost = (r: { url(): string; request(): { method(): string } }) =>
  r.url().endsWith("/api/media") && r.request().method() === "POST";

const publicUrl = (path: string) => `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}`;

async function newUser(context: Parameters<typeof seededUser>[0], label: string) {
  const user = await seededUser(context, label);
  owners.push(user.userId);
  // Start with no photo and no background, and nothing published to protect.
  const row = await pageRow(user.pageId);
  const draft = structuredClone(row.draft) as unknown as {
    profile: { photo: unknown };
    theme: { overrides: Record<string, unknown> };
  };
  draft.profile.photo = null;
  draft.theme = { ...draft.theme, overrides: {} };
  await adminClient().from("pages").update({ draft }).eq("id", user.pageId);
  return user;
}

const COPY = {
  unsupported: "That file type isn’t supported. Use JPEG, PNG or WebP.",
  tooBig: "That file is too big. Use an image under 4 MB.",
  unreadable: "We couldn’t read that image. Try a different file.",
  tooLarge: "That image is too large. Use one under 40 megapixels.",
} as const;

test.describe("M5-11 the avatar in the editor", () => {
  test("M5-11 a 9 MB 6000x4000 phone JPEG is downsized in the browser (at most 2400px, under the 4.5 MB body cap) and uploads as a 400x400 WebP", async ({
    page,
    context,
  }) => {
    test.skip(!UPLOAD_WIRED, NOT_WIRED);
    const user = await newUser(context, "w11");
    await openEditor(page);
    const phone = await makeJpeg({
      width: 6000,
      height: 4000,
      noise: true,
      quality: 55,
      gps: true,
    });
    expect(phone.length).toBeGreaterThan(4.5 * MIB);

    const sent: number[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/media") && request.method() === "POST") {
        sent.push(request.postDataBuffer()?.length ?? 0);
      }
    });
    // Slow the response so the uploading state can be seen.
    await page.route("**/api/media", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    const before = (await card(page).boundingBox())!;
    const posted = page.waitForResponse(isMediaPost);
    await fileInput(page).setInputFiles({
      name: "IMG_9001.JPG",
      mimeType: "image/jpeg",
      buffer: phone,
    });
    await confirmPhoto(page);
    await expect(card(page).getByRole("button", { name: "Uploading..." })).toBeDisabled();
    expect((await posted).status()).toBe(200);
    await page.unroute("**/api/media");
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();

    // What went over the wire fit the cap; the browser, not the server, made it small enough.
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toBeLessThan(4 * MIB);
    expect(sent[0]!).toBeLessThan(phone.length);

    const photo = (await expectDraft(user.pageId, (d) => d.profile.photo !== null)).profile.photo!;
    expect(photo.path).toMatch(new RegExp(`^${user.userId}/avatar-[0-9a-f]{32}\\.webp$`));
    expect([photo.width, photo.height]).toEqual([400, 400]);
    const stored = await sharp(await downloadObject(photo.path)).metadata();
    expect(stored.format).toBe("webp");
    expect(stored.exif).toBeUndefined();

    // The avatar shows the new image without moving anything, and the screen fits the viewport.
    await expect(avatar(page).locator("img")).toHaveAttribute(
      "src",
      `${MEDIA_ORIGIN}/media/${photo.path}`,
    );
    const after = (await card(page).boundingBox())!;
    // M6-24: "Adjust photo" is a third button once there is a photo. On a 390px phone it wraps to a
    // second row (44px plus the 6px gap); nothing else moves. (Recorded as an accepted deviation.)
    expect(after.height - before.height).toBeGreaterThanOrEqual(-1);
    expect(after.height - before.height).toBeLessThanOrEqual(50 + 1);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
  });

  test("M5-11 replace gives a new URL and updates the draft, Remove brings the initials back, and the live page keeps the old avatar until Publish", async ({
    page,
    context,
  }) => {
    const user = await newUser(context, "w11r");
    await openEditor(page);
    const pick = (color: [number, number, number], name: string) =>
      makePngImage({ width: 600, height: 500, color }).then(async (buffer) => {
        await fileInput(page).setInputFiles({ name, mimeType: "image/png", buffer });
        await confirmPhoto(page); // M6-24: the position dialog first, then the upload
      });

    await pick([200, 40, 40], "first.png");
    const first = (await expectDraft(user.pageId, (d) => d.profile.photo !== null)).profile.photo!;
    // Publish: the live page now shows the first avatar.
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    expect((await tenantGet(user.handle)).text).toContain(first.path);

    // Replace: a different URL in the draft, nothing live changes yet, the old object stays readable.
    await pick([40, 40, 200], "second.png");
    const second = (
      await expectDraft(
        user.pageId,
        (d) => d.profile.photo !== null && d.profile.photo.path !== first.path,
      )
    ).profile.photo!;
    expect(second.path).not.toBe(first.path);
    expect(second.path).toMatch(/\/avatar-[0-9a-f]{32}\.webp$/);
    const live = (await tenantGet(user.handle)).text;
    expect(live).toContain(first.path);
    expect(live).not.toContain(second.path);
    expect((await fetch(publicUrl(first.path))).status).toBe(200);

    // Identical bytes: the same URL, no new object.
    await pick([40, 40, 200], "second-again.png");
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    await expectDraft(user.pageId, (d) => d.profile.photo?.path === second.path);

    // Remove: initials back, draft photo null; the live page still shows the first until Publish.
    await card(page).getByRole("button", { name: "Remove" }).click();
    await expect(avatar(page)).toHaveAttribute("aria-label", /^Profile photo: initials /);
    await expectDraft(user.pageId, (d) => d.profile.photo === null);
    expect((await tenantGet(user.handle)).text).toContain(first.path);
  });

  test("M5-11 the public page's avatar makes no /_next/image request and carries width and height; decoding=async once the renderer has it", async ({
    page,
    context,
  }) => {
    const user = await newUser(context, "w11p");
    await openEditor(page);
    await fileInput(page).setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 500, height: 500 }),
    });
    await confirmPhoto(page);
    const photo = (await expectDraft(user.pageId, (d) => d.profile.photo !== null)).profile.photo!;
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });

    const requests: string[] = [];
    const live = await context.newPage();
    live.on("request", (request) => requests.push(request.url()));
    await live.goto(`http://${user.handle}.localhost:${SERVER_PORT}/`);
    const img = live.locator("img.pg-avatar-img");
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute("src", `${MEDIA_ORIGIN}/media/${photo.path}`);
    await expect(img).toHaveAttribute("width", /^\d+$/);
    await expect(img).toHaveAttribute("height", /^\d+$/);
    expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(requests.filter((u) => u.includes("/_next/image"))).toEqual([]);
    expect(requests.some((u) => u.includes(photo.path))).toBe(true);
    if (RENDER_WIRED) await expect(img).toHaveAttribute("decoding", "async");
    await live.close();
  });

  test("M5-11 every tenant image (avatar, card, image block) is a plain img with decoding=async", async ({
    page,
    context,
  }) => {
    test.skip(!RENDER_WIRED, NOT_WIRED);
    const user = await newUser(context, "w11d");
    await openEditor(page);
    await fileInput(page).setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 400, height: 400 }),
    });
    await confirmPhoto(page);
    await expectDraft(user.pageId, (d) => d.profile.photo !== null);
    const block = await addBlock(page, "image");
    await block.panel.locator('input[type="file"]').setInputFiles({
      name: "wide.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 800, height: 400 }),
    });
    await block.panel.getByLabel("Alt text", { exact: true }).fill("Wide");
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) => b.id === block.id && b.type === "image" && b.image !== null && b.alt !== "",
      ),
    );
    const cardBlock = await addBlock(page, "card");
    await cardBlock.panel.getByLabel("Title", { exact: true }).fill("A card");
    await cardBlock.panel.getByLabel("Link", { exact: true }).fill("https://example.com/");
    await cardBlock.panel.locator('input[type="file"]').setInputFiles({
      name: "banner.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 500, height: 200 }),
    });
    await expect(cardBlock.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 30_000,
    });
    await expectDraft(user.pageId, (d) =>
      d.blocks.some((b) => b.id === cardBlock.id && b.type === "card" && b.image !== null),
    );
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });

    const live = await context.newPage();
    await live.goto(`http://${user.handle}.localhost:${SERVER_PORT}/`);
    const images = live.locator("img.pg-avatar-img, img.pg-image-img, img.pg-card-image");
    await expect(images).toHaveCount(3);
    for (const img of await images.all()) {
      await expect(img).toHaveAttribute("decoding", "async");
      await expect(img).toHaveAttribute("width", /^\d+$/);
      await expect(img).toHaveAttribute("height", /^\d+$/);
    }
    await live.close();
  });
});

test.describe("M5-12 backgrounds and image blocks", () => {
  test("M5-12 Design background: a 4000x3000 PNG is stored as a 1600x1200 WebP, replace gives a new URL, Remove clears it, and the live page waits for Publish", async ({
    page,
    context,
  }) => {
    const user = await newUser(context, "w12");
    await openDesign(page);
    const input = page.getByTestId("background-file");
    const pick = (color: [number, number, number], name: string) =>
      makePngImage({ width: 4000, height: 3000, color }).then((buffer) =>
        input.setInputFiles({ name, mimeType: "image/png", buffer }),
      );

    const posted = page.waitForResponse(isMediaPost);
    await pick([30, 120, 90], "bg-a.png");
    expect((await posted).status()).toBe(200);
    const a = (
      await expectOverrides(
        user.pageId,
        (o) => o.bgType === "image" && typeof o.bgImage === "string",
      )
    ).bgImage as string;
    expect(a).toMatch(new RegExp(`/${user.userId}/bg-[0-9a-f]{32}\\.webp$`));
    const pathA = a.split(`/${BUCKET}/`)[1]!;
    const meta = await sharp(await downloadObject(pathA)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1600, 1200]);

    // The preview draws the background from the canonical root-origin /media address (M7-15; the stored form
    // is the Storage URL), in the full-size sheet on a phone (M7-09).
    await showPreviewSheet(page);
    await expect(previewRoot(page)).toHaveAttribute("data-bg-type", "image");
    expect(
      await computed(previewRoot(page).locator("[data-bg-layer=image]"), "background-image"),
    ).toBe(`url("${MEDIA_ORIGIN}/media/${pathA}")`);
    await hidePreviewSheet(page);
    await expectNoHorizontalScroll(page);
    if (isPhone(page)) await expectTapTargets(page, "main");

    // Publish, replace: the live page keeps showing A.
    await page.goto(page.url().replace("/design", "/editor"));
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    await openDesign(page);
    await pick([200, 80, 30], "bg-b.png");
    const b = (
      await expectOverrides(user.pageId, (o) => typeof o.bgImage === "string" && o.bgImage !== a)
    ).bgImage as string;
    expect(b).not.toBe(a);
    const live = (await tenantGet(user.handle)).text;
    expect(live).toContain(pathA);
    expect(live).not.toContain(b.split(`/${BUCKET}/`)[1]!);
    expect((await fetch(a)).status).toBe(200);

    // Identical bytes: the same URL.
    await pick([200, 80, 30], "bg-b-again.png");
    await expect(page.getByRole("button", { name: "Remove image" })).toBeVisible();
    await expectOverrides(user.pageId, (o) => o.bgImage === b);

    // Remove: solid again, bgImage cleared.
    await page.getByRole("button", { name: "Remove image" }).click();
    await expectOverrides(user.pageId, (o) => o.bgType === "solid" && o.bgImage === null);
    expect((await tenantGet(user.handle)).text).toContain(pathA);
  });

  test("M5-12 an image block uploads at the same size limits: 4000x3000 becomes 1600x1200, a card image too", async ({
    page,
    context,
  }) => {
    const user = await newUser(context, "w12b");
    await openEditor(page);
    const image = await addBlock(page, "image");
    await image.panel.locator('input[type="file"]').setInputFiles({
      name: "wide.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 4000, height: 3000 }),
    });
    await expect(image.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 30_000,
    });
    const tall = await addBlock(page, "card");
    await tall.panel.locator('input[type="file"]').setInputFiles({
      name: "tall.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg({ width: 2000, height: 2200 }),
    });
    await expect(tall.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 30_000,
    });
    const stored = await expectDraft(
      user.pageId,
      (d) =>
        d.blocks.some((b) => b.id === image.id && b.type === "image" && b.image !== null) &&
        d.blocks.some((b) => b.id === tall.id && b.type === "card" && b.image !== null),
    );
    const imageBlock = stored.blocks.find((b) => b.id === image.id)!;
    const cardBlock = stored.blocks.find((b) => b.id === tall.id)!;
    if (imageBlock.type !== "image" || cardBlock.type !== "card") throw new Error("blocks missing");
    expect([imageBlock.image!.width, imageBlock.image!.height]).toEqual([1600, 1200]);
    expect(imageBlock.image!.path).toMatch(/\/img-[0-9a-f]{32}\.webp$/);
    expect(cardBlock.image!.width).toBeLessThanOrEqual(1600);
    expect(cardBlock.image!.height).toBeLessThanOrEqual(1600);
    expect(cardBlock.image!.path).toMatch(/\/img-[0-9a-f]{32}\.webp$/);
    await expectNoHorizontalScroll(page);
  });

  test("M5-12 a page published with an avatar, a background and an image block makes zero /_next/image requests", async ({
    page,
    context,
  }) => {
    const user = await newUser(context, "w12z");
    await openEditor(page);
    await fileInput(page).setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 500, height: 500 }),
    });
    await confirmPhoto(page);
    await expectDraft(user.pageId, (d) => d.profile.photo !== null);
    const block = await addBlock(page, "image");
    await block.panel.locator('input[type="file"]').setInputFiles({
      name: "wide.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 1200, height: 800 }),
    });
    await expect(block.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 30_000,
    });
    await block.panel.getByLabel("Alt text", { exact: true }).fill("A wide picture");
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) => b.id === block.id && b.type === "image" && b.image !== null && b.alt !== "",
      ),
    );
    await openDesign(page);
    await page.getByTestId("background-file").setInputFiles({
      name: "bg.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 2000, height: 1200, color: [20, 60, 120] }),
    });
    await expectOverrides(
      user.pageId,
      (o) => o.bgType === "image" && typeof o.bgImage === "string",
    );
    await page.goto(page.url().replace("/design", "/editor"));
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });

    const requests: string[] = [];
    const live = await context.newPage();
    live.on("request", (request) => requests.push(request.url()));
    await live.goto(`http://${user.handle}.localhost:${SERVER_PORT}/`);
    await expect(live.locator("img.pg-avatar-img")).toHaveCount(1);
    await expect(live.locator("img.pg-image-img")).toHaveCount(1);
    await live.waitForLoadState("networkidle");
    expect(requests.filter((u) => u.includes("/_next/image"))).toEqual([]);
    // M7-15: the images come from the root origin's /media route, never from the Storage origin.
    expect(requests.filter((u) => u.includes("/media/")).length).toBeGreaterThanOrEqual(3);
    expect(requests.filter((u) => u.includes(`/${BUCKET}/`))).toEqual([]);
    for (const img of await live.locator("img.pg-avatar-img, img.pg-image-img").all()) {
      await expect(img).toHaveAttribute("width", /^\d+$/);
      await expect(img).toHaveAttribute("height", /^\d+$/);
    }
    await live.close();
  });
});

test.describe("M5-13 inline errors", () => {
  /** The alert is under the buttons, wraps inside the viewport, and uses the error colour. */
  async function expectErrorStyle(page: Page, text: string, scope: ReturnType<Page["locator"]>) {
    const alert = scope.getByRole("alert").filter({ hasText: text });
    await expect(alert).toBeVisible();
    expect(await computed(alert, "color")).toBe("rgb(178, 58, 43)"); // --hl-bad, as in Signup.dc.html
    await expectNoHorizontalScroll(page);
  }

  test("M5-13 Editor avatar: every refusal shows its sentence in a role=alert under the field and leaves the photo as it was", async ({
    page,
    context,
  }) => {
    test.skip(!UPLOAD_WIRED, NOT_WIRED);
    const user = await newUser(context, "w13");
    await openEditor(page);
    await fileInput(page).setInputFiles({
      name: "good.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 400, height: 400 }),
    });
    await confirmPhoto(page);
    const photo = (await expectDraft(user.pageId, (d) => d.profile.photo !== null)).profile.photo!;
    const unchanged = async () => {
      expect((await pageRow(user.pageId)).draft.profile.photo).toEqual(photo);
      await expect(avatar(page).locator("img")).toHaveAttribute(
        "src",
        `${MEDIA_ORIGIN}/media/${photo.path}`,
      );
    };
    const picker = uploadButton(page);
    expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // A GIF: refused in the browser, never sent.
    await fileInput(page).setInputFiles({ name: "party.gif", mimeType: "image/gif", buffer: GIF });
    await expectErrorStyle(page, COPY.unsupported, card(page));
    await unchanged();

    // A PNG that is not one: the browser cannot read it, the route says so.
    const png = await makePngImage({ width: 64, height: 64 });
    await fileInput(page).setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.concat([png.subarray(0, 50), Buffer.alloc(300, 9)]),
    });
    await expectErrorStyle(page, COPY.unreadable, card(page));
    await unchanged();

    // The route's own refusals for a 40 MP image and a file over 4 MB (what a direct request gets).
    for (const [status, error, message] of [
      [422, "image_too_large", COPY.tooLarge],
      [413, "file_too_large", COPY.tooBig],
      [415, "unsupported_type", COPY.unsupported],
    ] as const) {
      await page.route("**/api/media", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error, message }),
        }),
      );
      await fileInput(page).setInputFiles({
        name: "any.png",
        mimeType: "image/png",
        buffer: await makePngImage({ width: 64, height: 64 }),
      });
      await confirmPhoto(page);
      await expectErrorStyle(page, message, card(page));
      await unchanged();
      await page.unroute("**/api/media");
    }

    // The alert sits under the buttons and the control is still tappable.
    const alert = card(page).getByRole("alert").first();
    expect((await alert.boundingBox())!.y).toBeGreaterThan(
      (await uploadButton(page).boundingBox())!.y,
    );
    expect((await uploadButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectTapTargets(page, "main");

    // A good upload afterwards clears the message.
    await fileInput(page).setInputFiles({
      name: "next.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 400, height: 400, color: [10, 160, 40] }),
    });
    await confirmPhoto(page);
    await expectDraft(
      user.pageId,
      (d) => d.profile.photo !== null && d.profile.photo.path !== photo.path,
    );
    await expect(card(page).getByRole("alert")).toHaveCount(0);
  });

  test("M5-13 Design background: the same sentences appear in a role=alert and the existing background is left alone", async ({
    page,
    context,
  }) => {
    test.skip(!DESIGN_WIRED, NOT_WIRED);
    const user = await newUser(context, "w13d");
    await openDesign(page);
    const input = page.getByTestId("background-file");
    const posted = page.waitForResponse(isMediaPost);
    await input.setInputFiles({
      name: "bg.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 1800, height: 1200 }),
    });
    expect((await posted).status()).toBe(200);
    const bg = (
      await expectOverrides(
        user.pageId,
        (o) => o.bgType === "image" && typeof o.bgImage === "string",
      )
    ).bgImage as string;
    const unchanged = async () => {
      await expectOverrides(user.pageId, (o) => o.bgImage === bg && o.bgType === "image");
    };

    const scope = page.locator("main");
    await input.setInputFiles({ name: "party.gif", mimeType: "image/gif", buffer: GIF });
    await expectErrorStyle(page, COPY.unsupported, scope);
    await unchanged();

    const png = await makePngImage({ width: 64, height: 64 });
    await input.setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.concat([png.subarray(0, 50), Buffer.alloc(300, 9)]),
    });
    await expectErrorStyle(page, COPY.unreadable, scope);
    await unchanged();

    for (const [status, error, message] of [
      [422, "image_too_large", COPY.tooLarge],
      [413, "file_too_large", COPY.tooBig],
    ] as const) {
      await page.route("**/api/media", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error, message }),
        }),
      );
      await input.setInputFiles({
        name: "any.png",
        mimeType: "image/png",
        buffer: await makePngImage({ width: 64, height: 64 }),
      });
      await expectErrorStyle(page, message, scope);
      await unchanged();
      await page.unroute("**/api/media");
    }
    if (isPhone(page)) await expectTapTargets(page, "main");
  });
});

test.describe("M5-14 the editor works the cleanup queue", () => {
  test("M5-14 Publish deletes an image the live page used to show once the draft has replaced it, and not before", async ({
    page,
    context,
  }) => {
    test.skip(!PUBLISH_WIRED, NOT_WIRED);
    const user = await newUser(context, "w14");
    await openEditor(page);
    const pick = (color: [number, number, number], name: string) =>
      makePngImage({ width: 600, height: 500, color }).then(async (buffer) => {
        await fileInput(page).setInputFiles({ name, mimeType: "image/png", buffer });
        await confirmPhoto(page); // M6-24: the position dialog first, then the upload
      });

    // A is published; B replaces it in the draft: A must stay until the Publish that drops it.
    await pick([200, 40, 40], "a.png");
    const a = (await expectDraft(user.pageId, (d) => d.profile.photo !== null)).profile.photo!;
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    await pick([40, 40, 200], "b.png");
    const b = (
      await expectDraft(
        user.pageId,
        (d) => d.profile.photo !== null && d.profile.photo.path !== a.path,
      )
    ).profile.photo!;
    expect(await objectExists(a.path)).toBe(true);
    expect((await fetch(publicUrl(a.path))).status).toBe(200); // the live page still has its image

    // Publish: the Publish action works the queue off after updateTag, so A is gone and B is live.
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    await expect.poll(() => objectExists(a.path), { timeout: 15_000 }).toBe(false);
    expect(await objectExists(b.path)).toBe(true);
    expect((await tenantGet(user.handle)).text).toContain(b.path);
  });

  test("M5-14 a deleted block's image is cleaned up once the Undo window has passed; an Undo keeps its image", async ({
    page,
    context,
  }) => {
    test.skip(!SAVE_WIRED, NOT_WIRED);
    test.setTimeout(150_000);
    const user = await newUser(context, "w14u");
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", user.pageId);
    await openEditor(page);

    // Two image blocks; one is deleted for good and one is deleted and then Undone.
    const keep = await addBlock(page, "image");
    await keep.panel.locator('input[type="file"]').setInputFiles({
      name: "keep.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 500, height: 300, color: [20, 200, 20] }),
    });
    await expect(keep.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 30_000,
    });
    const gone = await addBlock(page, "image");
    await gone.panel.locator('input[type="file"]').setInputFiles({
      name: "gone.png",
      mimeType: "image/png",
      buffer: await makePngImage({ width: 500, height: 300, color: [200, 20, 200] }),
    });
    await expect(gone.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 30_000,
    });
    const withBoth = await expectDraft(
      user.pageId,
      (d) => d.blocks.filter((x) => x.type === "image" && x.image !== null).length === 2,
    );
    const imagePath = (id: string) => {
      const found = withBoth.blocks.find((x) => x.id === id);
      return found && found.type === "image" && found.image ? found.image.path : "";
    };
    const keepPath = imagePath(keep.id);
    const gonePath = imagePath(gone.id);
    expect(keepPath).not.toBe("");
    expect(gonePath).not.toBe("");

    const deleteBlock = async (id: string) => {
      const row = page.locator(`li[data-block-id="${id}"]`);
      const toggle = row.locator("button[aria-expanded]").first();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await row.getByRole("button", { name: "Delete block" }).click();
    };
    await deleteBlock(keep.id);
    await deleteBlock(gone.id);
    await expectDraft(
      user.pageId,
      (d) => !d.blocks.some((x) => x.id === keep.id || x.id === gone.id),
    );
    // The toast's Undo (the header has its own, M6-07) brings `gone` back.
    await page
      .getByRole("status")
      .filter({ hasText: "Block deleted." })
      .getByRole("button", { name: "Undo" })
      .click();
    await expectDraft(user.pageId, (d) => d.blocks.some((x) => x.id === gone.id));

    // Past the Undo window the editor asks the server to clean up: `keep` is deleted, `gone` stays.
    await expect.poll(() => objectExists(keepPath), { timeout: 40_000 }).toBe(false);
    expect(await objectExists(gonePath)).toBe(true);
  });
});
