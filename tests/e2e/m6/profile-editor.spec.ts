import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { userClient } from "../fixtures/auth";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { addBlock, showView } from "../m2/blocks-helpers";
import { makePng } from "../m2/editor-images";
import {
  accessToken,
  css,
  expectDraft,
  openEditor as openEditorBase,
  pageRow,
  previewScreen,
  reloadEditor as reloadEditorBase,
  seededUser,
  statusChip,
} from "../m2/editor-helpers";
import { adminClient } from "../fixtures/auth";
import { confirmPhoto } from "./position-dialog-helpers";
import { PROFILE_OPTION_DEFAULTS } from "@/lib/document";

/**
 * M6-16 (photo shape, size, border and show photo in the Profile card) and M6-18 (show name and show
 * bio switches), end to end in the editor. Each test makes its own user with a published copy of
 * mara's page (draft equals published, neither holding the new fields), so the status chip starts
 * on "Published".
 */

// Publish runs a Server Action on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 120_000 });

test.afterAll(cleanupUsers);

// M7-03: the photo controls and the three show switches sit under the collapsed "Photo and header
// options" button, so these specs open the section after the editor loads.
async function openOptions(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /^Photo and header options/ });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
}
async function openEditor(page: Page): Promise<void> {
  await openEditorBase(page);
  await openOptions(page);
}
async function reloadEditor(page: Page): Promise<void> {
  await reloadEditorBase(page);
  await openOptions(page);
}

const NAME = (page: Page) => page.getByLabel("Display name", { exact: true });
const BIO = (page: Page) => page.getByLabel("Bio", { exact: true });
const card = (page: Page) => page.getByTestId("profile-card");
const group = (page: Page, name: string) => card(page).getByRole("group", { name, exact: true });
const option = (page: Page, name: string, label: string) =>
  group(page, name).getByRole("button", { name: label, exact: true });
const toggle = (page: Page, name: string) => card(page).getByRole("button", { name, exact: true });
const publishButton = (page: Page) => page.getByRole("button", { name: /^Publish/ });
const cardAvatar = (page: Page) => card(page).getByRole("img", { name: /^Profile photo/ });

const NAME_HINT =
  "Hidden on the page. It still sets your page title and is read by screen readers.";
const BIO_HINT = "Hidden on the page. It can still show in search results and link previews.";
const PHOTO_HINT = "Your photo is hidden on the page. It stays here in case you want it back.";

test.describe("M6-16 photo controls in the Profile card", () => {
  test("M6-16 the card shows shape, size, border and show photo, with the defaults chosen", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "pc1");
    await openEditor(page);

    const groups: [string, string[], string][] = [
      ["Photo shape", ["Circle", "Rounded", "Square"], "Circle"],
      ["Photo size", ["Small", "Medium", "Large"], "Medium"],
      ["Photo border", ["Page default", "None", "Thin", "Thick"], "Page default"],
    ];
    for (const [name, labels, chosen] of groups) {
      await expect(group(page, name)).toBeVisible();
      for (const label of labels) {
        await expect(option(page, name, label)).toHaveAttribute(
          "aria-pressed",
          label === chosen ? "true" : "false",
        );
      }
      await expect(group(page, name)).not.toHaveAttribute("aria-disabled", "true");
    }
    await expect(toggle(page, "Show photo on page")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "Show display name on page")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "Show bio on page")).toHaveAttribute("aria-pressed", "true");

    // The chosen option is white on a ring; the others sit on the track.
    const on = option(page, "Photo shape", "Circle");
    expect(await css(on, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(group(page, "Photo shape"), "background-color")).toBe("rgb(239, 237, 233)");

    // Hit areas: the switches are at least 52x48, every option at least 44px tall.
    for (const name of ["Show photo on page", "Show display name on page", "Show bio on page"]) {
      const box = (await toggle(page, name).boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(52);
      expect(box.height, name).toBeGreaterThanOrEqual(48);
    }
    for (const [name] of groups) {
      for (const button of await group(page, name).getByRole("button").all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // The label is not clipped.
        expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
    }
    // The photo group sits under the upload row.
    const upload = (await card(page).getByRole("button", { name: "Upload photo" }).boundingBox())!;
    const shape = (await group(page, "Photo shape").boundingBox())!;
    expect(shape.y).toBeGreaterThan(upload.y + upload.height - 1);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="profile-card"]');
    if (desktopOnly(info)) {
      // At 1440 the groups and the switch sit inside the 720px column, each group's options on a row.
      const column = (await card(page).boundingBox())!;
      expect(column.width).toBeLessThanOrEqual(720);
      for (const [name] of groups) {
        const ys = new Set<number>();
        for (const button of await group(page, name).getByRole("button").all()) {
          ys.add(Math.round((await button.boundingBox())!.y));
        }
        expect(ys.size, `${name} on one row`).toBe(1);
        const box = (await group(page, name).boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width);
      }
    }
    await card(page).screenshot({ path: `tmp/screens/m6-profile-card-${info.project.name}.png` });
  });

  test("M6-16 every choice changes the preview and the draft, and the chip follows", async ({
    page,
    context,
  }, info) => {
    test.skip(
      !desktopOnly(info),
      "the full flow runs on the desktop project; phone has its own layout test",
    );
    const user = await seededUser(context, "pc2");
    await openEditor(page);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");

    // The save carries only `draft`.
    const patch = page.waitForRequest(
      (request) => request.method() === "PATCH" && request.url().includes("/rest/v1/pages"),
    );
    await option(page, "Photo shape", "Square").click();
    expect(Object.keys((await patch).postDataJSON() as object)).toEqual(["draft"]);

    const avatar = previewScreen(page).locator(".pg-avatar");
    await expect(avatar).toHaveAttribute("data-shape", "square");
    expect(await css(avatar, "border-top-left-radius")).toBe("0px");
    await expect(option(page, "Photo shape", "Square")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo shape", "Circle")).toHaveAttribute("aria-pressed", "false");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");

    // The draft stores all six, explicitly, with the new value.
    const stored = await expectDraft(user.pageId, (d) => d.profile.photoShape === "square");
    expect(stored.profile).toMatchObject({ ...PROFILE_OPTION_DEFAULTS, photoShape: "square" });

    await option(page, "Photo size", "Large").click();
    await option(page, "Photo border", "Thick").click();
    await expect(avatar).toHaveAttribute("data-size", "large");
    await expect(avatar).toHaveAttribute("data-border", "thick");
    expect(await css(avatar, "border-top-width")).toBe("4px");
    // The preview frame is a narrow container: large steps down to 96px there.
    expect((await avatar.boundingBox())!.width).toBe(96);
    await option(page, "Photo size", "Small").click();
    expect((await avatar.boundingBox())!.width).toBe(48);
    await option(page, "Photo border", "None").click();
    expect(await css(avatar, "border-top-width")).toBe("0px");
    await option(page, "Photo shape", "Rounded").click();
    expect(await css(avatar, "border-top-left-radius")).toBe("24%");

    // After a reload the choices are still there.
    await expectDraft(
      user.pageId,
      (d) =>
        d.profile.photoShape === "rounded" &&
        d.profile.photoSize === "small" &&
        d.profile.photoBorder === "none",
    );
    await reloadEditor(page);
    await expect(option(page, "Photo shape", "Rounded")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo size", "Small")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo border", "None")).toHaveAttribute("aria-pressed", "true");

    // The live page keeps the old look until Publish.
    const live = await page.context().newPage();
    await live.goto(url(user.handle));
    await expect(live.locator(".pg-avatar")).toHaveAttribute("data-shape", "circle");
    await expect(live.locator(".pg-avatar")).toHaveAttribute("data-size", "medium");
    await live.close();

    // Back to the defaults: the chip is Published again.
    await option(page, "Photo shape", "Circle").click();
    await option(page, "Photo size", "Medium").click();
    await option(page, "Photo border", "Page default").click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
  });

  test("M6-16 the card's own avatar follows the shape and ignores size and border", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop project");
    await seededUser(context, "pc3");
    await openEditor(page);
    const avatar = cardAvatar(page);
    await expect(avatar).toHaveText(/^[A-Z?]{1,2}$/);
    expect(await css(avatar, "border-top-left-radius")).toBe("50%");

    await option(page, "Photo shape", "Square").click();
    expect(await css(avatar, "border-top-left-radius")).toBe("0px");
    await option(page, "Photo shape", "Rounded").click();
    expect(await css(avatar, "border-top-left-radius")).toBe("24%");
    // The initials sit inside that shape: the avatar's own box is the shape.
    expect(await css(avatar, "border-top-right-radius")).toBe("24%");

    const before = (await avatar.boundingBox())!;
    await option(page, "Photo size", "Large").click();
    await option(page, "Photo border", "Thick").click();
    const after = (await avatar.boundingBox())!;
    expect([after.width, after.height]).toEqual([72, 72]);
    expect([before.width, before.height]).toEqual([72, 72]);
    expect(await css(avatar, "border-top-width")).toBe("1px");
  });

  test("M6-16 show photo off draws no photo, disables the three groups and keeps the choices", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop project");
    const user = await seededUser(context, "pc4");
    await openEditor(page);

    // Upload a photo first, so there is a file the draft references.
    await card(page)
      .locator("input[type=file]")
      .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: makePng(80, 80) });
    await confirmPhoto(page); // M6-24: the position dialog first
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
    const withPhoto = await expectDraft(user.pageId, (d) => d.profile.photo !== null);
    const path = withPhoto.profile.photo!.path;
    const avatar = previewScreen(page).locator(".pg-avatar");
    await expect(avatar.locator("img")).toHaveCount(1);

    await option(page, "Photo shape", "Rounded").click();
    await option(page, "Photo size", "Large").click();
    await option(page, "Photo border", "Thick").click();

    await toggle(page, "Show photo on page").click();
    await expect(toggle(page, "Show photo on page")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(PHOTO_HINT)).toBeVisible();
    for (const name of ["Photo shape", "Photo size", "Photo border"]) {
      await expect(group(page, name)).toHaveAttribute("aria-disabled", "true");
      for (const button of await group(page, name).getByRole("button").all()) {
        await expect(button).toBeDisabled();
      }
    }
    // The preview draws no avatar element at all, with the photo still in the draft.
    await expect(previewScreen(page).locator(".pg-avatar")).toHaveCount(0);
    await expect(previewScreen(page).getByRole("img", { name: /Mara|zq-/ })).toHaveCount(0);
    // Upload, Replace and Remove still work.
    await expect(card(page).getByRole("button", { name: "Replace photo" })).toBeEnabled();
    await expect(card(page).getByRole("button", { name: "Remove" })).toBeEnabled();

    const hidden = await expectDraft(user.pageId, (d) => d.profile.showPhoto === false);
    expect(hidden.profile.photo?.path).toBe(path);
    // The uploaded file is still there while the draft references it: the cleanup's own rule (M5-14,
    // `media_paths_in_use`) counts the hidden photo as in use, nothing is queued for it, and the
    // file downloads after the save has had time to trigger a cleanup.
    const admin = adminClient();
    const inUse = await admin.rpc("media_paths_in_use", { p_uid: user.userId, p_paths: [path] });
    expect(inUse.error).toBeNull();
    expect(inUse.data).toEqual([path]);
    const queued = await admin.from("image_cleanup_queue").select("path").eq("path", path);
    expect(queued.data).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const download = await admin.storage.from("page-media").download(path);
    expect(download.error).toBeNull();

    // Back on: the earlier choices come back exactly.
    await toggle(page, "Show photo on page").click();
    await expect(page.getByText(PHOTO_HINT)).toHaveCount(0);
    await expect(option(page, "Photo shape", "Rounded")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo size", "Large")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo border", "Thick")).toHaveAttribute("aria-pressed", "true");
    await expect(avatar).toHaveAttribute("data-shape", "rounded");
    await expect(avatar).toHaveAttribute("data-size", "large");
    await expect(avatar).toHaveAttribute("data-border", "thick");
  });

  test("M6-16 / M6-18 every choice and every switch is one undo step", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop project");
    await seededUser(context, "pc6");
    await openEditor(page);
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const avatar = previewScreen(page).locator(".pg-avatar");

    await option(page, "Photo shape", "Rounded").click();
    await option(page, "Photo shape", "Square").click();
    await toggle(page, "Show display name on page").click();
    await expect(avatar).toHaveAttribute("data-shape", "square");

    await undo.click();
    await expect(toggle(page, "Show display name on page")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo shape", "Square")).toHaveAttribute("aria-pressed", "true");
    await undo.click();
    await expect(option(page, "Photo shape", "Rounded")).toHaveAttribute("aria-pressed", "true");
    await expect(avatar).toHaveAttribute("data-shape", "rounded");
    await undo.click();
    await expect(option(page, "Photo shape", "Circle")).toHaveAttribute("aria-pressed", "true");
    await expect(avatar).toHaveAttribute("data-shape", "circle");
    // Back at the published look: the chip says so.
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
  });

  test("M6-16 / M6-18 the docked thumbnail on a phone follows every choice and switch as soon as the press returns", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the dock is a phone feature");
    await seededUser(context, "pc7");
    await openEditor(page);
    const thumb = page.getByTestId("mini-preview");
    const avatar = thumb.locator(".pg-avatar");
    await expect(avatar).toHaveAttribute("data-shape", "circle");

    // No waiting and no polling: the thumbnail is drawn from the same draft in the same render.
    await option(page, "Photo shape", "Square").click();
    expect(await avatar.getAttribute("data-shape")).toBe("square");
    await option(page, "Photo size", "Large").click();
    expect(await avatar.getAttribute("data-size")).toBe("large");
    await option(page, "Photo border", "Thick").click();
    expect(await avatar.getAttribute("data-border")).toBe("thick");

    await toggle(page, "Show display name on page").click();
    expect(await thumb.locator(".pg-name[data-profile-part=name]").count()).toBe(0);
    expect((await thumb.locator("h1.pg-name").boundingBox())!.width).toBeLessThanOrEqual(1);
    await toggle(page, "Show bio on page").click();
    expect(await thumb.locator(".pg-bio").count()).toBe(0);
    await toggle(page, "Show photo on page").click();
    expect(await avatar.count()).toBe(0);

    // Back on: the earlier choices come back exactly.
    await toggle(page, "Show photo on page").click();
    expect(await avatar.getAttribute("data-shape")).toBe("square");
    expect(await avatar.getAttribute("data-size")).toBe("large");
    expect(await avatar.getAttribute("data-border")).toBe("thick");
    await toggle(page, "Show display name on page").click();
    await toggle(page, "Show bio on page").click();
    expect(await thumb.locator(".pg-name[data-profile-part=name]").count()).toBe(1);
    expect(await thumb.locator(".pg-bio").count()).toBe(1);
  });

  test("M6-18 a tap where the hidden name was opens nothing", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "the bezel preview is on the desktop project");
    await seededUser(context, "pc8");
    await openEditor(page);
    await toggle(page, "Show display name on page").click();
    const screen = previewScreen(page);
    await expect(screen.locator("h1.pg-name")).toHaveCount(1);
    await expect(screen.locator("h1.pg-name[data-profile-part]")).toHaveCount(0);
    // Nothing is open and nothing has focus before; a click on the hidden heading changes neither.
    await expect(page.locator("li[data-block-id] button[aria-expanded='true']")).toHaveCount(0);
    await page.getByRole("button", { name: "Show bio on page" }).focus();
    await screen.locator("h1.pg-name").click({ force: true });
    await expect(page.locator("li[data-block-id] button[aria-expanded='true']")).toHaveCount(0);
    await expect(NAME(page)).not.toBeFocused();
    await expect(BIO(page)).not.toBeFocused();
  });

  test("M6-16 with the photo hidden the layout still fits a phone, and nothing is clipped", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "pc5");
    await openEditor(page);
    await toggle(page, "Show photo on page").click();
    await toggle(page, "Show display name on page").click();
    await toggle(page, "Show bio on page").click();
    for (const hint of [PHOTO_HINT, NAME_HINT, BIO_HINT])
      await expect(page.getByText(hint)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="profile-card"]');
    // Labels wrap instead of running off the card.
    const cardBox = (await card(page).boundingBox())!;
    for (const name of ["Show photo on page", "Show display name on page", "Show bio on page"]) {
      const box = (await toggle(page, name).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await card(page).screenshot({
      path: `tmp/screens/m6-profile-card-off-${info.project.name}.png`,
    });
  });
});

test.describe("M6-18 show name and show bio", () => {
  test("M6-18 the name and bio switches hide them in the preview, keep the heading and the chip follows", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the full flow runs on the desktop project");
    const user = await seededUser(context, "sn1");
    await openEditor(page);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
    const originalName = await NAME(page).inputValue();

    // On by default, labels visible, the inputs untouched.
    await expect(toggle(page, "Show display name on page")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "Show bio on page")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(NAME_HINT)).toHaveCount(0);
    await expect(page.getByText(BIO_HINT)).toHaveCount(0);

    const screen = previewScreen(page);
    await expect(screen.locator(".pg-name[data-profile-part=name]")).toHaveText(originalName);

    const nameBefore = (await NAME(page).boundingBox())!;
    await toggle(page, "Show display name on page").click();
    await expect(toggle(page, "Show display name on page")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByText(NAME_HINT)).toBeVisible();
    // The name leaves the preview but the page keeps its one h1, hidden; no tap target.
    await expect(screen.locator(".pg-name[data-profile-part=name]")).toHaveCount(0);
    await expect(screen.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText(originalName);
    expect(await css(screen.locator("h1.pg-name"), "position")).toBe("absolute");
    expect((await screen.locator("h1.pg-name").boundingBox())!.width).toBeLessThanOrEqual(1);
    // The input stays enabled and editable, and does not move sideways.
    await expect(NAME(page)).toBeEnabled();
    const nameAfter = (await NAME(page).boundingBox())!;
    expect(nameAfter.x).toBe(nameBefore.x);
    expect(nameAfter.width).toBe(nameBefore.width);
    await NAME(page).fill("Mara O");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Mara O");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");

    // Stored explicitly, and kept after a reload.
    await expectDraft(
      user.pageId,
      (d) => d.profile.showName === false && d.profile.name === "Mara O",
    );
    await reloadEditor(page);
    await expect(toggle(page, "Show display name on page")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByText(NAME_HINT)).toBeVisible();

    // The live page keeps its look until Publish.
    const live = await page.context().newPage();
    await live.goto(url(user.handle));
    await expect(live.locator(".pg-name[data-profile-part=name]")).toHaveCount(1);
    await live.close();

    // Bio.
    await toggle(page, "Show bio on page").click();
    await expect(page.getByText(BIO_HINT)).toBeVisible();
    await expect(screen.locator(".pg-bio")).toHaveCount(0);
    await expect(BIO(page)).toBeEnabled();
    await expectDraft(user.pageId, (d) => d.profile.showBio === false);

    // Both on again and the name restored: Published.
    await toggle(page, "Show display name on page").click();
    await toggle(page, "Show bio on page").click();
    await NAME(page).fill(originalName);
    await expect(screen.locator(".pg-name[data-profile-part=name]")).toHaveText(originalName);
    await expect(screen.locator(".pg-bio")).toHaveCount(1);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
  });

  test("M6-18 the name stays required when it is hidden", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "desktop project");
    await seededUser(context, "sn2");
    await openEditor(page);
    await toggle(page, "Show display name on page").click();
    await NAME(page).fill("");
    await publishButton(page).click();
    await expect(page.getByText("Add a display name.").first()).toBeVisible();
    await expect(NAME(page)).toBeFocused();
    await expect(NAME(page)).toHaveAttribute("aria-invalid", "true");
    // The hint stays too: the name is still described by both.
    await expect(page.getByText(NAME_HINT)).toBeVisible();
  });

  test("M6-18 with the photo, name and bio off, a header block opens the page with no gap", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "sn3");
    await openEditor(page);
    await toggle(page, "Show photo on page").click();
    await toggle(page, "Show display name on page").click();
    await toggle(page, "Show bio on page").click();

    // Hide every block of the copied page, so the new header is the first thing drawn.
    for (const row of await page.locator("li[data-block-id]").all()) {
      const visible = row.getByRole("button", { name: "Visible on page" });
      if ((await visible.getAttribute("aria-pressed")) === "true") await visible.click();
    }
    const { panel } = await addBlock(page, "header");
    await panel.getByRole("textbox").first().fill("Mara Okafor");

    await showView(page, "Preview");
    const screen = previewScreen(page);
    await expect(screen.locator(".pg-profile")).toHaveCount(0);
    await expect(screen.locator("h2.pg-header")).toHaveText("Mara Okafor");
    const gap = await screen.evaluate((el) => {
      const column = el.querySelector<HTMLElement>(".pg-column")!;
      const first = el.querySelector<HTMLElement>(".pg-blocks > *")!;
      const padding = Number.parseFloat(getComputedStyle(column).paddingTop);
      return first.getBoundingClientRect().top - column.getBoundingClientRect().top - padding;
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    await screen.screenshot({
      path: `tmp/screens/m6-profile-top-from-blocks-${info.project.name}.png`,
    });
  });
});

test.describe("M6-15 / M6-17 stored values outside the lists", () => {
  test("M6-15 a draft with bad photo options opens with the defaults and the notice, and Publish is refused", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop project");
    const user = await seededUser(context, "ab1");
    const before = await pageRow(user.pageId);
    const token = await accessToken(context);

    // Through PostgREST, with the user's own session, as a client that skips the editor would.
    const bad = {
      ...before.draft,
      profile: {
        ...before.draft.profile,
        photoShape: "blob",
        photoSize: "999",
        photoBorder: "url(x)",
        showPhoto: "yes",
      },
    };
    const write = await userClient(token)
      .from("pages")
      .update({ draft: bad })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();

    await openEditor(page);
    await expect(
      page.getByText("Some content couldn’t be read and was reset in the editor."),
    ).toBeVisible();
    await expect(option(page, "Photo shape", "Circle")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo size", "Medium")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Photo border", "Page default")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(toggle(page, "Show photo on page")).toHaveAttribute("aria-pressed", "true");

    await publishButton(page).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Fix your profile before publishing." });
    await expect(alert).toBeVisible();
    for (const message of [
      "Choose a photo shape from the list.",
      "Choose a photo size from the list.",
      "Choose a photo border from the list.",
      "Choose on or off.",
    ]) {
      await expect(alert).toContainText(message);
    }
    // Nothing was published, and the live HTML never holds the bad values.
    expect((await pageRow(user.pageId)).published).toEqual(before.published);
    const html = await (await page.request.get(url(user.handle))).text();
    expect(html).not.toMatch(/blob|url\(x\)/);
    expect(html).not.toContain("999");
  });

  test("M6-17 a draft with a string for a switch opens with both on and the notice, and Publish names both", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop project");
    const user = await seededUser(context, "ab2");
    const before = await pageRow(user.pageId);
    const token = await accessToken(context);
    const bad = {
      ...before.draft,
      profile: { ...before.draft.profile, showName: "false", showBio: 0 },
    };
    const write = await userClient(token)
      .from("pages")
      .update({ draft: bad })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();

    await openEditor(page);
    await expect(
      page.getByText("Some content couldn’t be read and was reset in the editor."),
    ).toBeVisible();
    await expect(toggle(page, "Show display name on page")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "Show bio on page")).toHaveAttribute("aria-pressed", "true");

    await publishButton(page).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Fix your profile before publishing." });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Choose on or off.");
    expect((await pageRow(user.pageId)).published).toEqual(before.published);
  });
});
