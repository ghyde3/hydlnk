import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { codePointLength } from "@/lib/document";
import {
  css,
  expectDraft,
  mark,
  openEditor,
  pageRow,
  previewScreen,
  reloadEditor,
  saveIndicator,
  seededUser,
} from "./editor-helpers";
import { confirmPhoto } from "../m6/position-dialog-helpers";
import { makeJpeg } from "../m5/images-fixtures";
import { makePng } from "./editor-images";
import { hidePreviewSheet, showPreviewSheet } from "../m7/phone-preview";

/** M2-07 (display name and bio) and M2-09 (profile photo upload, replace, remove). */

test.afterAll(cleanupUsers);

const NAME = (page: Page) => page.getByLabel("Display name", { exact: true });
const BIO = (page: Page) => page.getByLabel("Bio", { exact: true });
const card = (page: Page) => page.getByRole("region", { name: "Profile", exact: true });
const avatar = (page: Page) => card(page).getByRole("img", { name: /^Profile photo/ });
const fileInput = (page: Page) => card(page).locator("input[type=file]");
const counter = (page: Page) => card(page).getByText(/^\d+ \/ 160$/);

/** On a phone the preview is on its own tab. */
async function showPreview(page: Page, info: { project: { name: string } }) {
  if (info.project.name === "phone") await showPreviewSheet(page);
}

test.describe("M2-07 display name and bio", () => {
  test("M2-07 the Profile card: look, fields and counter", async ({ page, context }) => {
    await seededUser(context, "pr1");
    await openEditor(page);
    const section = card(page);
    expect(await css(section, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(section, "border-top-width")).toBe("1px");
    expect(await css(section, "border-top-color")).toBe("rgb(226, 223, 217)");
    expect(await css(section, "border-top-left-radius")).toBe("6px");
    expect(await css(section, "padding-top")).toBe("16px");
    await expect(section.getByRole("heading", { level: 2, name: "Profile" })).toBeVisible();
    await expect(section.getByText("Shown at the top of your page")).toBeVisible();

    await expect(NAME(page)).toHaveAttribute("autocomplete", "name");
    expect(await css(NAME(page), "font-size")).toBe("16px");
    expect((await NAME(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(BIO(page)).toHaveAttribute("rows", "2");
    expect(await css(BIO(page), "font-size")).toBe("16px");
    expect((await BIO(page).boundingBox())!.height).toBeGreaterThanOrEqual(64);

    const count = counter(page);
    await expect(count).toHaveText("44 / 160");
    expect(await css(count, "font-size")).toBe("11px");
    expect(await css(count, "font-family")).toMatch(/Geist.?Mono/);
    // Right-aligned inside the card.
    const cardBox = (await section.boundingBox())!;
    const countBox = (await count.boundingBox())!;
    expect(countBox.x + countBox.width).toBeGreaterThan(cardBox.x + cardBox.width - 24);
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  });

  test("M2-07 the counter follows every keystroke", async ({ page, context }) => {
    await seededUser(context, "pr2");
    await openEditor(page);
    await BIO(page).fill("");
    await expect(counter(page)).toHaveText("0 / 160");
    await BIO(page).pressSequentially("abc");
    await expect(counter(page)).toHaveText("3 / 160");
    await BIO(page).press("Backspace");
    await expect(counter(page)).toHaveText("2 / 160");
  });

  test("M2-07 a long paste is cut to 160 (bio) and 60 (name) code points; an emoji counts as one", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pr3");
    await openEditor(page);
    await BIO(page).fill("x".repeat(200));
    expect(await BIO(page).inputValue()).toHaveLength(160);
    await expect(counter(page)).toHaveText("160 / 160");
    await NAME(page).fill("n".repeat(80));
    expect(await NAME(page).inputValue()).toHaveLength(60);

    await BIO(page).fill("😀".repeat(200));
    const bio = await BIO(page).inputValue();
    expect(codePointLength(bio)).toBe(160);
    expect(bio).toHaveLength(320); // 160 emoji, two UTF-16 units each
    await expect(counter(page)).toHaveText("160 / 160");
    await NAME(page).fill("😀".repeat(70));
    expect(codePointLength(await NAME(page).inputValue())).toBe(60);

    // A real paste (clipboard and Ctrl/Cmd+V), not only a programmatic fill.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("p".repeat(200)));
    await BIO(page).fill("");
    await BIO(page).focus();
    await page.keyboard.press("ControlOrMeta+V");
    await expect(counter(page)).toHaveText("160 / 160");
  });

  test("M2-07 edits update the draft (autosaved), the initials avatar and the live preview; reload keeps them; the live page does not change", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "pr4");
    await openEditor(page);
    const name = "Mara Okafor";
    const bio = `Bio ${mark()}`;
    await NAME(page).fill(name);
    await BIO(page).fill(bio);
    await expect(avatar(page)).toHaveAttribute("aria-label", "Profile photo: initials MO");
    await showPreview(page, info);
    await expect(previewScreen(page).locator("h1")).toHaveText(name);
    await expect(previewScreen(page)).toContainText(bio);
    if (phoneOnly(info)) await hidePreviewSheet(page);

    await expect(saveIndicator(page)).toHaveText("Saved");
    const stored = await expectDraft(user.pageId, (d) => d.profile.bio === bio);
    expect(stored.profile.name).toBe(name);

    await reloadEditor(page);
    await expect(NAME(page)).toHaveValue(name);
    await expect(BIO(page)).toHaveValue(bio);

    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.body).not.toContain(bio);
    expect(live.body).toContain(user.handle); // the published name
  });

  test("M2-07 initials: 'Prince' gives P, an empty name gives ?, 'jean claude van damme' gives JD", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pr5");
    await openEditor(page);
    const section = card(page);
    await NAME(page).fill("Prince");
    await expect(avatar(page)).toHaveAttribute("aria-label", "Profile photo: initials P");
    await NAME(page).fill("");
    await expect(avatar(page)).toHaveAttribute("aria-label", "Profile photo: initials ?");
    await NAME(page).fill("jean claude van damme");
    await expect(avatar(page)).toHaveAttribute("aria-label", "Profile photo: initials JD");
    await NAME(page).fill("Mara Okafor");
    await expect(avatar(page)).toHaveAttribute("role", "img");
    // The initials circle: 72px, #EFEDE9, 1px #D9D6D0, #3A3733 at 22px/600.
    const box = (await avatar(page).boundingBox())!;
    expect(box.width).toBe(72);
    expect(box.height).toBe(72);
    expect(await css(avatar(page), "background-color")).toBe("rgb(239, 237, 233)");
    expect(await css(avatar(page), "border-top-width")).toBe("1px");
    expect(await css(avatar(page), "border-top-color")).toBe("rgb(217, 214, 208)");
    expect(await css(avatar(page), "color")).toBe("rgb(58, 55, 51)");
    expect(await css(avatar(page), "font-size")).toBe("22px");
    expect(await css(avatar(page), "font-weight")).toBe("600");
    expect(await css(avatar(page), "border-top-left-radius")).not.toBe("0px");
    await expect(section.getByText("MO", { exact: true })).toBeVisible();
  });

  test("M2-07 markup in the name and bio is literal text in the preview and fires no dialog", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "pr6");
    await openEditor(page);
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await NAME(page).fill("<b>x</b>");
    await BIO(page).fill("<script>alert(1)</script>");
    await showPreview(page, info);
    const screen = previewScreen(page);
    await expect(screen.locator("h1")).toHaveText("<b>x</b>");
    await expect(screen).toContainText("<script>alert(1)</script>");
    await expect(screen.locator("h1 b")).toHaveCount(0);
    await expect(screen.locator("script")).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(dialogs).toBe(0);
  });

  test("M2-07 phone: 44px controls, 16px text, the counter stays in the card, no sideways scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "pr7");
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await expectTapTargets(page, "[aria-labelledby]");
    const cardBox = (await card(page).boundingBox())!;
    const countBox = (await counter(page).boundingBox())!;
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(cardBox.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(390 - 16 + 0.5);
    await BIO(page).fill("y".repeat(160));
    await expectNoHorizontalScroll(page);
  });

  test("M2-07 desktop: the card fills the block column (max 720px)", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "pr8");
    await openEditor(page);
    // M7-02: the block column is the workspace's tab panel.
    const column = (await page.getByRole("tabpanel").boundingBox())!;
    const box = (await card(page).boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.width - column.width)).toBeLessThanOrEqual(1);
  });
});

test.describe("M2-09 profile photo", () => {
  test("M2-09 no photo: the initials circle, an Upload photo button, the help text and a file input for JPG, PNG, WebP", async ({
    page,
    context,
  }) => {
    await seededUser(context, "ph1");
    await openEditor(page);
    await expect(avatar(page)).toHaveAttribute("aria-label", /initials/);
    await expect(card(page).getByRole("button", { name: "Upload photo" })).toBeVisible();
    await expect(
      card(page).getByText("JPG or PNG, square works best. Without a photo, your initials show."),
    ).toBeVisible();
    await expect(fileInput(page)).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    await expect(card(page).getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("M2-09 upload, replace and remove: only the draft changes, nothing is deleted from Storage, the live page waits for Publish", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "ph2");
    await openEditor(page);
    const storageCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/storage/v1/") && request.method() !== "GET") {
        storageCalls.push(`${request.method()} ${request.url()}`);
      }
    });

    // Hold the upload so "Uploading..." can be seen.
    await page.route("**/api/media", async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    await fileInput(page).setInputFiles({
      name: "first.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg({ width: 400, height: 400 }),
    });
    await confirmPhoto(page);
    const busy = card(page).getByRole("button", { name: "Uploading..." });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();

    // The avatar is the image: a circle with object-fit cover.
    const image = avatar(page).locator("img");
    await expect(image).toHaveCount(1);
    expect(await css(image, "object-fit")).toBe("cover");
    expect(parseFloat(await css(avatar(page), "border-top-left-radius"))).toBeGreaterThanOrEqual(
      36,
    );
    const remove = card(page).getByRole("button", { name: "Remove" });
    await expect(remove).toBeVisible();
    expect(await css(remove, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(remove, "border-top-color")).toBe("rgb(232, 196, 189)");
    expect(await css(remove, "color")).toBe("rgb(178, 58, 43)");

    await expect(saveIndicator(page)).toHaveText("Saved");
    const first = (await expectDraft(user.pageId, (d) => d.profile.photo !== null)).profile.photo!;
    expect(first.width).toBe(400);
    expect(first.height).toBe(400);
    // M5-11: the avatar is stored as a 400px WebP named by its content hash.
    expect(first.path).toMatch(/^[0-9a-f-]{36}\/avatar-[0-9a-f]{32}\.webp$/);
    expect(Object.keys(first).sort()).toEqual(["height", "path", "width"]);

    await showPreview(page, info);
    await expect(previewScreen(page).locator("header img")).toHaveAttribute(
      "src",
      new RegExp(first.path.replace(/[.]/g, "\\.")),
    );
    if (phoneOnly(info)) await hidePreviewSheet(page);

    // Before Publish, the live page does not know the new image; after Publish it does.
    const before = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(before.body).not.toContain(first.path);

    // Replace with a second file.
    await fileInput(page).setInputFiles({
      name: "second.png",
      mimeType: "image/png",
      buffer: makePng(300, 200),
    });
    await confirmPhoto(page);
    const second = (
      await expectDraft(
        user.pageId,
        (d) => d.profile.photo !== null && d.profile.photo.path !== first.path,
      )
    ).profile.photo!;
    expect(second.path).toMatch(/\.webp$/);
    expect([second.width, second.height]).toEqual([200, 200]); // a square crop, never enlarged

    // Remove: the initials come back, the draft photo is null.
    await card(page).getByRole("button", { name: "Remove" }).click();
    await expect(avatar(page)).toHaveAttribute("aria-label", /^Profile photo: initials /);
    await expect(card(page).getByRole("button", { name: "Upload photo" })).toBeVisible();
    await expectDraft(user.pageId, (d) => d.profile.photo === null);
    await showPreview(page, info);
    await expect(previewScreen(page).locator("header img")).toHaveCount(0);
    if (phoneOnly(info)) await hidePreviewSheet(page);

    // No Storage write or delete from the page, and both objects are still readable.
    expect(storageCalls).toEqual([]);
    for (const path of [first.path, second.path]) {
      const res = await fetch(`${supabaseUrl()}/storage/v1/object/public/page-media/${path}`);
      expect(res.status, path).toBe(200);
    }
  });

  test("M2-09 after Publish the live page renders the photo as the avatar, the display name as alt text", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "ph3");
    await openEditor(page);
    await fileInput(page).setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: makePng(400, 400),
    });
    await confirmPhoto(page);
    const photo = (await expectDraft(user.pageId, (d) => d.profile.photo !== null)).profile.photo!;
    const before = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(before.body).not.toContain(photo.path);

    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveText("Published");
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).toContain(photo.path);
    expect(live.body).toMatch(new RegExp(`alt="${user.handle}"`));
  });

  test("M2-09 a text file renamed .jpg and a 5 MB image are refused inline; the draft is unchanged", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "ph4");
    await openEditor(page);
    const before = (await pageRow(user.pageId)).draft;
    let uploads = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/media")) uploads += 1;
    });

    await fileInput(page).setInputFiles({
      name: "notes.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("this is only text, not an image"),
    });
    await expect(
      card(page).getByText("That file type isn’t supported. Use JPEG, PNG or WebP."),
    ).toBeVisible();

    // M5-11: a big photo the browser can read is downsized and sent; one it cannot read (a PNG
    // header, then 5 MB of nothing) stays 5 MB and is refused before anything is sent.
    await fileInput(page).setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.concat([makePng(10, 10).subarray(0, 40), Buffer.alloc(5 * 1024 * 1024, 7)]),
    });
    await expect(
      card(page).getByText("That file is too big. Use an image under 4 MB."),
    ).toBeVisible();
    await expect(card(page).getByText("That file type isn’t supported")).toHaveCount(0);

    await page.waitForTimeout(1500);
    expect(uploads).toBe(0); // refused before anything was sent
    await expect(card(page).getByRole("button", { name: "Upload photo" })).toBeEnabled();
    await expect(card(page).getByRole("button", { name: "Remove" })).toHaveCount(0);
    expect((await pageRow(user.pageId)).draft).toEqual(before);
    await expect(saveIndicator(page)).toHaveText("");
  });

  test("M2-09 the server's own refusals (415, 413, 422) show the same inline errors", async ({
    page,
    context,
  }) => {
    await seededUser(context, "ph5");
    await openEditor(page);
    // A GIF passes no client sniff either, so force the server answers with a stubbed route.
    for (const [status, text] of [
      [413, "That file is too big. Use an image under 4 MB."],
      [415, "That file type isn’t supported. Use JPEG, PNG or WebP."],
      [422, "We couldn’t read that image. Try a different file."],
    ] as const) {
      await page.route("**/api/media", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: "x" }),
        }),
      );
      await fileInput(page).setInputFiles({
        name: "ok.png",
        mimeType: "image/png",
        buffer: makePng(8, 8),
      });
      await confirmPhoto(page);
      await expect(card(page).getByText(text)).toBeVisible();
      await page.unroute("**/api/media");
    }
  });

  test("M2-09 phone: no sideways scroll; Upload, Replace and Remove are 44px and wrap", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "ph6");
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[aria-labelledby]");
    await fileInput(page).setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: makePng(64, 64),
    });
    await confirmPhoto(page);
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[aria-labelledby]");
    for (const name of ["Replace photo", "Remove"]) {
      const box = (await card(page).getByRole("button", { name }).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(390 - 16);
    }
  });

  test("M2-09 desktop: the avatar and the buttons sit in one row", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "ph7");
    await openEditor(page);
    await fileInput(page).setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: makePng(64, 64),
    });
    await confirmPhoto(page);
    const upload = (await card(page).getByRole("button", { name: "Replace photo" }).boundingBox())!;
    const remove = (await card(page).getByRole("button", { name: "Remove" }).boundingBox())!;
    const face = (await avatar(page).boundingBox())!;
    expect(upload.x).toBeGreaterThanOrEqual(face.x + face.width);
    expect(upload.y).toBeLessThan(face.y + face.height);
    expect(remove.y).toBeLessThan(face.y + face.height);
    expect(Math.abs(upload.y - remove.y)).toBeLessThan(4);
  });
});
