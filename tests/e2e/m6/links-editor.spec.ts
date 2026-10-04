import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, phoneOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { draftOf, userWithDraft, uploadImage } from "../m2/blocks-helpers";
import { makePng } from "../m2/editor-images";
import {
  expectDraft,
  openEditor,
  reloadEditor,
  rowOf,
  saveIndicator,
  setDraft,
  statusChip,
} from "../m2/editor-helpers";
import { padTo } from "../m2/publish-helpers";
import { markupOf } from "../m7/markup";
import { inPreviewSheet } from "../m7/phone-preview";
import { signInAsUser } from "../m5/admin-helpers";
import { LINK_ICONS, LINK_ICON_LABELS } from "@/lib/document";

/**
 * M6-21 (choose an icon or upload a thumbnail for a link) and M6-22's editor side (the Feature
 * switch and the Motion select), end to end in the editor, plus the parity of the preview and the
 * live page after Publish. Each test makes its own user: the phone and desktop projects run at
 * once, and two contexts autosaving one draft would trip the stale-tab guard.
 */

test.afterAll(async () => {
  await cleanupUsers();
});
// Publish and uploads run on a dev server other suites share: allow time.
test.describe.configure({ timeout: 120_000 });

const MIB = 1024 * 1024;
const IDS = {
  a: "Lk-edit-aaaa01",
  b: "Lk-edit-bbbb02",
  c: "Lk-edit-cccc03",
  d: "Lk-edit-dddd04",
  e: "Lk-edit-eeee05",
};

const link = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "link",
  visible: true,
  label: `Link ${id.slice(-2)}`,
  url: `https://example.com/${id.slice(-2)}`,
  ...extra,
});

async function expand(page: Page, id: string) {
  const row = rowOf(page, id);
  const main = row.locator("button[aria-expanded]").first();
  if ((await main.getAttribute("aria-expanded")) !== "true") await main.click();
  const panel = row.locator('[id^="block-panel-"]');
  await expect(panel).toBeVisible();
  return { row, panel, field: panel.getByTestId("link-icon-field") };
}

const choose = (field: Locator) => field.getByRole("button", { name: "Choose icon" });
const iconPanel = (field: Locator) => field.getByTestId("link-icon-panel");
const iconButtons = (field: Locator) =>
  iconPanel(field).getByRole("group", { name: "Icons", exact: true }).getByRole("button");
const tab = (field: Locator, name: "Icons" | "Your image") =>
  iconPanel(field)
    .getByRole("group", { name: "Icon source" })
    .getByRole("button", { name, exact: true });
const draftBlock = (draft: { blocks: unknown[] }, id: string) =>
  draft.blocks.find((b) => (b as { id: string }).id === id) as Record<string, unknown> | undefined;
const previewLink = (page: Page, id: string) =>
  page.getByTestId("preview-screen").locator(`.pg-link[data-block-id="${id}"]`);
/** Picks `file` and goes through the position dialog (M6-24): its title, then "Use image". */
async function pickAndUse(
  page: Page,
  box: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await box.locator('input[type="file"]').setInputFiles(file);
  const dialog = page.getByRole("dialog", { name: "Position your image" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Use image", exact: true }).click();
  await expect(dialog).toBeHidden();
}
const positionDialog = (page: Page) => page.getByRole("dialog", { name: "Position your image" });
const publishButton = (page: Page) =>
  page.getByRole("button", { name: "Publish", exact: true }).first();

test.describe("M6-21 the Icon field", () => {
  test("M6-21 a tile, a Choose icon button and an inline panel with the Icons tab: No icon and the 24 icons, on every plan", async ({
    page,
    context,
  }, info) => {
    await userWithDraft(context, "ie1", (h) => draftOf(h, [link(IDS.a)]));
    await openEditor(page);
    const { panel, field } = await expand(page, IDS.a);

    // The field sits under Label and Link, with an empty 44px tile and a 44px secondary button.
    await expect(field.getByText("Icon", { exact: true })).toBeVisible();
    const tile = field.getByTestId("link-icon-tile");
    await expect(tile).toHaveAttribute("data-icon", "none");
    const tileBox = (await tile.boundingBox())!;
    expect([Math.round(tileBox.width), Math.round(tileBox.height)]).toEqual([44, 44]);
    expect((await choose(field).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const labelBox = (await panel.getByLabel("Label", { exact: true }).boundingBox())!;
    const urlBox = (await panel.getByLabel("Link", { exact: true }).boundingBox())!;
    expect(tileBox.y).toBeGreaterThan(Math.max(labelBox.y, urlBox.y));
    await expect(iconPanel(field)).toHaveCount(0);

    // A Free account sees no Pro chip and no upgrade prompt anywhere on the card.
    await expect(panel.getByText(/\bPro\b/)).toHaveCount(0);
    await expect(panel.getByText(/upgrade/i)).toHaveCount(0);

    await choose(field).click();
    await expect(choose(field)).toHaveAttribute("aria-expanded", "true");
    // An inline panel, not a modal.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(iconPanel(field)).toBeVisible();
    for (const name of ["Icons", "Your image"] as const) {
      expect((await tab(field, name).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // No icon yet: the Icons tab is the open one.
    await expect(tab(field, "Icons")).toHaveAttribute("aria-pressed", "true");
    await expect(tab(field, "Your image")).toHaveAttribute("aria-pressed", "false");
    await expect(
      iconPanel(field).getByRole("button", { name: "No icon", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // The 24 icons, named, 44x44, none of them pressed.
    const buttons = iconButtons(field);
    await expect(buttons).toHaveCount(24);
    const names = await buttons.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")),
    );
    expect(names).toEqual([
      "Instagram",
      "TikTok",
      "YouTube",
      "X",
      "Facebook",
      "LinkedIn",
      "GitHub",
      "Threads",
      "Link",
      "Email",
      "Website",
      "Music",
      "Video",
      "Microphone",
      "Camera",
      "Calendar",
      "Shopping bag",
      "Ticket",
      "Heart",
      "Star",
      "Book",
      "Gift",
      "Location",
      "Phone",
    ]);
    expect(names).toEqual(LINK_ICONS.map((n) => LINK_ICON_LABELS[n]));
    const boxes = await buttons.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          y: Math.round(r.y),
          pressed: el.getAttribute("aria-pressed"),
        };
      }),
    );
    for (const b of boxes) {
      expect([b.w, b.h]).toEqual([44, 44]);
      expect(b.pressed).toBe("false");
    }
    const rowsY = [...new Set(boxes.map((b) => b.y))];
    if (phoneOnly(info)) {
      // Six per row.
      expect(boxes.filter((b) => b.y === boxes[0]!.y)).toHaveLength(6);
      expect(rowsY).toHaveLength(4);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, `li[data-block-id="${IDS.a}"]`);
      // Inputs keep 16px text so the phone does not zoom.
      for (const label of ["Label", "Link"]) {
        const size = await panel
          .getByRole("textbox", { name: label, exact: true })
          .evaluate((el) => getComputedStyle(el).fontSize);
        expect(size).toBe("16px");
      }
    }
    if (desktopOnly(info)) {
      expect(rowsY.length).toBeLessThanOrEqual(4);
      const panelBox = (await panel.boundingBox())!;
      expect(panelBox.width).toBeLessThanOrEqual(720);
      const inner = (await iconPanel(field).boundingBox())!;
      expect(inner.x).toBeGreaterThanOrEqual(panelBox.x);
      expect(inner.x + inner.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
      await expectNoHorizontalScroll(page);
    }
    await page.screenshot({ path: `tmp/screens/m6-link-icon-panel-${info.project.name}.png` });
  });

  test("M6-21 choosing an icon updates the tile and the preview at once and autosaves it; No icon removes the key", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ie2", (h) => draftOf(h, [link(IDS.a), link(IDS.b)]));
    await openEditor(page);
    const { field } = await expand(page, IDS.a);
    await choose(field).click();

    const instagram = iconPanel(field).getByRole("button", { name: "Instagram", exact: true });
    await instagram.click();
    await expect(instagram).toHaveAttribute("aria-pressed", "true");
    await expect(field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "builtin");
    await expect(field.getByTestId("link-icon-tile").locator("svg")).toBeVisible();
    // The live preview: the glyph is the first child of the link and the label is unchanged.
    const preview = previewLink(page, IDS.a);
    await inPreviewSheet(page, async () => {
      await expect(preview.locator("> svg.pg-link-icon")).toHaveCount(1);
      await expect(preview).toHaveAttribute("data-icon", "builtin");
      await expect(preview).toHaveText("Link 01");
    });
    await expect
      .poll(
        async () =>
          (await adminClient().from("pages").select("draft").eq("id", user.pageId).single()).data!
            .draft.blocks[0].icon,
      )
      .toEqual({ type: "builtin", name: "instagram" });

    // Another icon replaces it; only that one is pressed.
    await iconPanel(field).getByRole("button", { name: "Shopping bag", exact: true }).click();
    await expect(
      iconPanel(field).getByRole("button", { name: "Shopping bag", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(instagram).toHaveAttribute("aria-pressed", "false");
    await expectDraft(
      user.pageId,
      (d) => (draftBlock(d, IDS.a)!.icon as { name: string }).name === "bag",
    );
    // The other link is untouched.
    expect(draftBlock(await expectDraft(user.pageId, () => true), IDS.b)!.icon).toBeUndefined();

    // No icon: the key is gone, the tile is empty again, the preview is the bare label.
    await iconPanel(field).getByRole("button", { name: "No icon", exact: true }).click();
    await expect(
      iconPanel(field).getByRole("button", { name: "No icon", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "none");
    await inPreviewSheet(page, () => expect(preview).not.toHaveAttribute("data-icon", /.+/));
    await expectDraft(user.pageId, (d) => !("icon" in draftBlock(d, IDS.a)!));
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved");
  });

  test("M6-21 the panel opens on the tab that matches the current icon", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ie3", (h) =>
      draftOf(h, [link(IDS.a, { icon: { type: "builtin", name: "gift" } })]),
    );
    const upload = await uploadImage(user.userId, 400, 400);
    await setDraft(
      user.pageId,
      draftOf(user.handle, [
        link(IDS.a, { icon: { type: "builtin", name: "gift" } }),
        link(IDS.b, { icon: { type: "image", image: upload } }),
      ]),
    );
    await openEditor(page);
    const a = await expand(page, IDS.a);
    await expect(a.field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "builtin");
    await choose(a.field).click();
    await expect(tab(a.field, "Icons")).toHaveAttribute("aria-pressed", "true");
    await expect(
      iconPanel(a.field).getByRole("button", { name: "Gift", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    const b = await expand(page, IDS.b);
    await expect(b.field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "image");
    await choose(b.field).click();
    await expect(tab(b.field, "Your image")).toHaveAttribute("aria-pressed", "true");
    await expect(iconPanel(b.field).getByRole("button", { name: "Replace image" })).toBeVisible();
    await expect(
      iconPanel(b.field).getByRole("button", { name: "Remove", exact: true }),
    ).toBeVisible();
  });

  test("M6-21 keyboard: the grid is in the tab order and chosen with Enter or Space; Escape closes the panel and returns to Choose icon", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ie4", (h) => draftOf(h, [link(IDS.a)]));
    await openEditor(page);
    const { field } = await expand(page, IDS.a);
    await choose(field).focus();
    await page.keyboard.press("Enter");
    await expect(iconPanel(field)).toBeVisible();

    // Every control of the grid is a real button in the tab order.
    const tabIndexes = await iconPanel(field)
      .getByRole("button")
      .evaluateAll((els) => els.map((el) => (el as HTMLButtonElement).tabIndex));
    expect(tabIndexes.every((i) => i === 0)).toBe(true);

    // Tab from the Icons tab: Your image, No icon, then Instagram, TikTok...
    await tab(field, "Icons").focus();
    await page.keyboard.press("Tab");
    await expect(tab(field, "Your image")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      iconPanel(field).getByRole("button", { name: "No icon", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      iconPanel(field).getByRole("button", { name: "Instagram", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expectDraft(
      user.pageId,
      (d) => (draftBlock(d, IDS.a)!.icon as { name: string })?.name === "instagram",
    );
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(
      iconPanel(field).getByRole("button", { name: "TikTok", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectDraft(
      user.pageId,
      (d) => (draftBlock(d, IDS.a)!.icon as { name: string })?.name === "tiktok",
    );

    await page.keyboard.press("Escape");
    await expect(iconPanel(field)).toHaveCount(0);
    await expect(choose(field)).toBeFocused();
    await expect(choose(field)).toHaveAttribute("aria-expanded", "false");
    // The row itself stays open and the choice stays.
    await expect(field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "builtin");
  });
});

test.describe("M6-21 Your image", () => {
  test("M6-21 the upload control: the words, the help text, kind=avatar, a 400px WebP in the owner's folder; each choice replaces the other; Remove and No icon clear it; nothing is deleted from Storage", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "iu1", (h) => draftOf(h, [link(IDS.a)]));
    const requests: { method: string; url: string }[] = [];
    page.on("request", (request) =>
      requests.push({ method: request.method(), url: request.url() }),
    );
    // The upload's multipart body, to see which kind the browser asked for.
    const uploadBodies: string[] = [];
    await page.route("**/api/media", async (route) => {
      uploadBodies.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
      await route.continue();
    });
    await openEditor(page);
    const { field } = await expand(page, IDS.a);
    await choose(field).click();
    await tab(field, "Your image").click();
    const box = field.getByTestId("link-thumb-upload");
    await expect(box.getByRole("button", { name: "Upload image", exact: true })).toBeVisible();
    await expect(
      box.getByText("JPG, PNG or WebP. Shown as a small square next to the label."),
    ).toBeVisible();
    for (const button of await box.getByRole("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(box.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);

    // A file is picked and uploaded.
    await pickAndUse(page, box, {
      name: "thumb.png",
      mimeType: "image/png",
      buffer: makePng(600, 600, [30, 120, 200]),
    });
    const pattern = new RegExp(`^${user.userId}/avatar-[0-9a-f]{12,}\\.webp$`);
    const saved = await expectDraft(user.pageId, (d) => {
      const icon = draftBlock(d, IDS.a)!.icon as
        { type: string; image: { path: string } } | undefined;
      return icon?.type === "image" && pattern.test(icon.image.path);
    });
    const icon = draftBlock(saved, IDS.a)!.icon as {
      type: string;
      image: { path: string; width: number; height: number };
    };
    expect(Object.keys(icon).sort()).toEqual(["image", "type"]);
    expect(icon.image).toMatchObject({ width: 400, height: 400 });
    expect(Object.keys(icon.image).sort()).toEqual(["height", "path", "width"]);

    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/api/media"));
    expect(post, "POST /api/media").toBeTruthy();
    expect(uploadBodies[0]).toMatch(/name="kind"\r\n\r\navatar/);

    // The tile and the preview show the thumbnail; the button says Replace image; Remove shows.
    await expect(field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "image");
    const tileImg = field.getByTestId("link-icon-tile").locator("img");
    await expect(tileImg).toHaveAttribute("src", new RegExp(`^/media/${user.userId}/avatar-`));
    expect(await tileImg.evaluate((img: HTMLImageElement) => [img.width, img.height])).toEqual([
      40, 40,
    ]);
    const preview = previewLink(page, IDS.a);
    await inPreviewSheet(page, () =>
      expect(preview.locator("> img.pg-link-thumb")).toHaveAttribute("width", "40"),
    );
    await expect(box.getByRole("button", { name: "Replace image", exact: true })).toBeVisible();

    // Choosing a built-in icon replaces the uploaded one: never both.
    await tab(field, "Icons").click();
    await iconPanel(field).getByRole("button", { name: "Heart", exact: true }).click();
    await expectDraft(user.pageId, (d) => {
      const i = draftBlock(d, IDS.a)!.icon as { type: string; name?: string; image?: unknown };
      return i.type === "builtin" && i.name === "heart" && i.image === undefined;
    });
    await inPreviewSheet(page, () => expect(preview.locator("> img.pg-link-thumb")).toHaveCount(0));
    // ...and uploading replaces a built-in one.
    await tab(field, "Your image").click();
    await pickAndUse(page, box, {
      name: "thumb2.png",
      mimeType: "image/png",
      buffer: makePng(300, 500, [200, 40, 40]),
    });
    await expectDraft(user.pageId, (d) => {
      const i = draftBlock(d, IDS.a)!.icon as {
        type: string;
        name?: string;
        image?: { path: string };
      };
      return i.type === "image" && i.name === undefined && i.image!.path !== icon.image.path;
    });
    // Remove clears it; so does No icon.
    await box.getByRole("button", { name: "Remove", exact: true }).click();
    await expectDraft(user.pageId, (d) => !("icon" in draftBlock(d, IDS.a)!));
    await expect(field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "none");
    await pickAndUse(page, box, {
      name: "thumb3.png",
      mimeType: "image/png",
      buffer: makePng(256, 256),
    });
    await expectDraft(
      user.pageId,
      (d) => (draftBlock(d, IDS.a)!.icon as { type: string } | undefined)?.type === "image",
    );
    await tab(field, "Icons").click();
    await iconPanel(field).getByRole("button", { name: "No icon", exact: true }).click();
    await expectDraft(user.pageId, (d) => !("icon" in draftBlock(d, IDS.a)!));

    // Nothing was deleted from Storage by the browser.
    const deletes = requests.filter(
      (r) =>
        r.method === "DELETE" ||
        /\/storage\/v1\/object\/(?!public)/.test(r.url) ||
        (/\/api\/media\/?$/.test(r.url) && r.method !== "POST"),
    );
    expect(deletes, JSON.stringify(deletes)).toEqual([]);
  });

  test("M6-21 picking a file opens the position dialog (Position your image, Use image); Cancel and Escape upload nothing and return focus to the button", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "iu4", (h) =>
      draftOf(h, [link(IDS.a, { icon: { type: "builtin", name: "star" } })]),
    );
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/media")) posts.push(r.url());
    });
    await openEditor(page);
    const { field } = await expand(page, IDS.a);
    await choose(field).click();
    await tab(field, "Your image").click();
    const box = field.getByTestId("link-thumb-upload");
    const file = { name: "thumb.png", mimeType: "image/png", buffer: makePng(500, 300) };

    await box.locator('input[type="file"]').setInputFiles(file);
    const dialog = positionDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("button", { name: "Use image", exact: true })).toBeVisible();
    // Nothing is uploaded by picking.
    expect(posts).toEqual([]);

    // Cancel: no upload, the icon is as it was, focus is back on the button that opened it.
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(box.getByRole("button", { name: "Upload image", exact: true })).toBeFocused();
    await expect(iconPanel(field)).toBeVisible();

    // Escape in the dialog is Cancel, and it does not close the icon panel behind it.
    await box.locator('input[type="file"]').setInputFiles(file);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(iconPanel(field)).toBeVisible();
    await expect(box.getByRole("button", { name: "Upload image", exact: true })).toBeFocused();
    expect(posts).toEqual([]);
    const saved = await expectDraft(user.pageId, () => true);
    expect(draftBlock(saved, IDS.a)!.icon).toEqual({ type: "builtin", name: "star" });

    // Use image uploads the result.
    await pickAndUse(page, box, file);
    await expectDraft(
      user.pageId,
      (d) => (draftBlock(d, IDS.a)!.icon as { type: string } | undefined)?.type === "image",
    );
    expect(posts).toHaveLength(1);
  });

  test("M6-21 upload errors show inline with role=alert and leave the icon as it was", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "iu2", (h) =>
      draftOf(h, [link(IDS.a, { icon: { type: "builtin", name: "star" } })]),
    );
    await openEditor(page);
    const { field } = await expand(page, IDS.a);
    await choose(field).click();
    await tab(field, "Your image").click();
    const box = field.getByTestId("link-thumb-upload");
    const input = box.locator('input[type="file"]');
    const alert = box.getByRole("alert");

    // A text file renamed .jpg.
    await input.setInputFiles({
      name: "notes.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("just some text, not a picture"),
    });
    await expect(alert).toHaveText("That file type isn’t supported. Use JPEG, PNG or WebP.");
    // A PNG header with nothing decodable behind it: the dialog never opens.
    await input.setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64),
      ]),
    });
    await expect(alert).toHaveText("We couldn’t read that image. Try a different file.");
    await expect(positionDialog(page)).toHaveCount(0);

    // The route's own sentences (here stubbed, as the cropped file is far under 4 MB) show as they come.
    await page.route("**/api/media", (route) =>
      route.fulfill({
        status: 413,
        contentType: "application/json",
        body: JSON.stringify({
          error: "file_too_large",
          message: "That file is too big. Use an image under 4 MB.",
        }),
      }),
    );
    await pickAndUse(page, box, { name: "ok.png", mimeType: "image/png", buffer: makePng(64, 64) });
    await expect(alert).toHaveText("That file is too big. Use an image under 4 MB.");
    await expect(box.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await page.unroute("**/api/media");

    // The icon is exactly what it was, in the tile, the preview and the draft.
    await expect(field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "builtin");
    await inPreviewSheet(page, () =>
      expect(previewLink(page, IDS.a)).toHaveAttribute("data-icon", "builtin"),
    );
    const saved = await expectDraft(user.pageId, () => true);
    expect(draftBlock(saved, IDS.a)!.icon).toEqual({ type: "builtin", name: "star" });
  });

  test("M6-21 a Free account at its upload limit sees the plan's sentence and a 44px Try again", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "iu3", (h) =>
      draftOf(h, [link(IDS.a, { icon: { type: "builtin", name: "star" } })]),
    );
    const seeded: string[] = [];
    for (let left = 10 * MIB - 10, i = 0; left > 0; i++) {
      const size = Math.min(left, 4 * MIB);
      const path = `${user.userId}/seed-${rand(6)}-${i}.png`;
      const { error } = await adminClient()
        .storage.from("page-media")
        .upload(path, Buffer.alloc(size), { contentType: "image/png" });
      if (error) throw new Error(error.message);
      seeded.push(path);
      left -= size;
    }
    try {
      await openEditor(page);
      const { field } = await expand(page, IDS.a);
      await choose(field).click();
      await tab(field, "Your image").click();
      const box = field.getByTestId("link-thumb-upload");
      await pickAndUse(page, box, {
        name: "big.png",
        mimeType: "image/png",
        buffer: padTo(makePng(8, 8), 2 * MIB),
      });
      const alert = box
        .getByRole("alert")
        .filter({ hasText: "Uploads are limited to 10 MB on Free. Delete an image or upgrade." });
      await expect(alert).toBeVisible({ timeout: 30_000 });
      const retry = box.getByRole("button", { name: "Try again" });
      expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(field.getByTestId("link-icon-tile")).toHaveAttribute("data-icon", "builtin");
      const saved = await expectDraft(user.pageId, () => true);
      expect(draftBlock(saved, IDS.a)!.icon).toEqual({ type: "builtin", name: "star" });
    } finally {
      await adminClient().storage.from("page-media").remove(seeded);
    }
  });

  test("M6-21 a suspended owner sees the upload button disabled, with the reason", async ({
    page,
    context,
  }) => {
    const owner = await signInAsUser(context, "isus", { plan: "pro", suspended: true });
    await setDraft(owner.pageId!, draftOf(owner.handle!, [link(IDS.a)]));
    await openEditor(page);
    const { field } = await expand(page, IDS.a);
    await choose(field).click();
    await tab(field, "Your image").click();
    const upload = field
      .getByTestId("link-thumb-upload")
      .getByRole("button", { name: "Upload image", exact: true });
    await expect(upload).toBeDisabled();
    await expect(upload).toHaveAttribute("title", "Your account is suspended.");
    await expect(
      field.getByTestId("link-thumb-upload").getByText("Your account is suspended."),
    ).toBeVisible();
  });
});

test.describe("M6-21 Publish errors under the Icon field", () => {
  test("M6-21 each message from the gate shows under the Icon field, the block opens and focus lands on Choose icon", async ({
    page,
    context,
  }) => {
    const stranger = await makeUser("iestr");
    const user = await userWithDraft(context, "ie5", (h) => draftOf(h, [link(IDS.a)]));
    const cases: [string, unknown, string][] = [
      [
        "a name that is not on the list",
        { type: "builtin", name: "Instagram" },
        "Pick an icon from the list.",
      ],
      [
        "another account's folder",
        {
          type: "image",
          image: { path: `${stranger.id}/avatar-0123456789ab.webp`, width: 400, height: 400 },
        },
        "That image isn’t in your uploads. Upload it again.",
      ],
      [
        "an object that is not there",
        {
          type: "image",
          image: { path: `${user.userId}/avatar-0123456789ab.webp`, width: 400, height: 400 },
        },
        "That image is no longer available. Upload it again.",
      ],
    ];
    await openEditor(page);
    for (const [name, icon, message] of cases) {
      await setDraft(user.pageId, draftOf(user.handle, [link(IDS.a, { icon })]));
      await reloadEditor(page);
      await publishButton(page).click();
      const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
      await expect(alert, name).toBeVisible();
      await expect(alert).toContainText(message);
      const { row, field } = await expand(page, IDS.a);
      await expect(row.locator('button[aria-expanded="true"]').first()).toBeVisible();
      await expect(field.locator('p[data-field="icon"]'), name).toHaveText(message);
      await expect(choose(field), name).toBeFocused();
      const published = await adminClient()
        .from("pages")
        .select("published, published_at")
        .eq("id", user.pageId)
        .single();
      expect(published.data).toEqual({ published: null, published_at: null });
    }
    // Choosing an icon clears the message.
    const { field } = await expand(page, IDS.a);
    await choose(field).click();
    await tab(field, "Icons").click();
    await iconPanel(field).getByRole("button", { name: "Star", exact: true }).click();
    await expect(field.locator('p[data-field="icon"]')).toHaveCount(0);
  });
});

test.describe("M6-22 the Feature switch and Motion", () => {
  test("M6-22 the switch, its hint, the Motion select and the Featured chip; off removes the key", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "if1", (h) => draftOf(h, [link(IDS.a), link(IDS.b)]));
    await openEditor(page);
    const { row, panel } = await expand(page, IDS.a);
    const feature = panel.getByRole("button", { name: "Feature this link", exact: true });
    await expect(feature).toHaveAttribute("aria-pressed", "false");
    const box = (await feature.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(52);
    await expect(
      panel.getByText("Makes this link stand out. You can feature up to 3."),
    ).toBeVisible();
    await expect(panel.getByLabel("Motion", { exact: true })).toHaveCount(0);
    await expect(row.getByTestId("featured-chip")).toHaveCount(0);
    // On every plan: no Pro chip.
    await expect(panel.getByText(/\bPro\b/)).toHaveCount(0);

    await feature.click();
    await expect(feature).toHaveAttribute("aria-pressed", "true");
    const motion = panel.getByLabel("Motion", { exact: true });
    await expect(motion).toBeVisible();
    expect(await motion.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect(await motion.locator("option").allTextContents()).toEqual([
      "None",
      "Gentle pulse",
      "Soft shine",
    ]);
    await expect(motion).toHaveValue("bold");
    await expect(
      panel.getByText("Motion turns off for people who ask their device for less motion."),
    ).toBeVisible();
    await expectDraft(user.pageId, (d) => draftBlock(d, IDS.a)!.featured === "bold");
    await inPreviewSheet(page, () =>
      expect(previewLink(page, IDS.a)).toHaveAttribute("data-featured", "bold"),
    );

    // The chip: shown from 760px, hidden on a phone.
    const chip = row.getByTestId("featured-chip");
    await expect(chip).toHaveText("Featured");
    if (desktopOnly(info)) {
      await expect(chip).toBeVisible();
      const style = await chip.evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: s.fontSize, font: s.fontFamily, bg: s.backgroundColor };
      });
      expect(style.size).toBe("11px");
      expect(style.font).toMatch(/mono/i);
      expect(style.bg).toBe("rgb(246, 238, 223)");
    } else {
      await expect(chip).toBeHidden();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, `li[data-block-id="${IDS.a}"]`);
    }

    await motion.selectOption("pulse");
    await expectDraft(user.pageId, (d) => draftBlock(d, IDS.a)!.featured === "pulse");
    await inPreviewSheet(page, () =>
      expect(previewLink(page, IDS.a)).toHaveAttribute("data-featured", "pulse"),
    );
    await motion.selectOption("shine");
    await expectDraft(user.pageId, (d) => draftBlock(d, IDS.a)!.featured === "shine");
    await motion.selectOption("bold");
    await expectDraft(user.pageId, (d) => draftBlock(d, IDS.a)!.featured === "bold");

    // The override controls never carry it.
    const saved = await expectDraft(user.pageId, () => true);
    expect(draftBlock(saved, IDS.a)!.overrides).toBeUndefined();

    await feature.click();
    await expect(feature).toHaveAttribute("aria-pressed", "false");
    await expect(panel.getByLabel("Motion", { exact: true })).toHaveCount(0);
    await expectDraft(user.pageId, (d) => !("featured" in draftBlock(d, IDS.a)!));
    await inPreviewSheet(page, () =>
      expect(previewLink(page, IDS.a)).not.toHaveAttribute("data-featured", /.+/),
    );
    await expect(chip).toHaveCount(0);
    await page.screenshot({ path: `tmp/screens/m6-link-feature-${info.project.name}.png` });
  });

  test("M6-22 on a fourth featured link the switch is disabled and says why; turning one off frees it; a hidden link does not count", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "if2", (h) =>
      draftOf(h, [
        link(IDS.a, { featured: "bold" }),
        link(IDS.b, { featured: "pulse" }),
        link(IDS.c, { featured: "shine" }),
        link(IDS.d),
        link(IDS.e, { featured: "bold", visible: false }),
      ]),
    );
    await openEditor(page);
    const sentence = "Feature up to 3 links. Turn one off to feature another.";
    const d = await expand(page, IDS.d);
    const featureD = d.panel.getByRole("button", { name: "Feature this link", exact: true });
    await expect(featureD).toBeDisabled();
    await expect(d.panel.getByText(sentence)).toBeVisible();

    // The hidden featured link (5th) did not use up a place: only the three visible ones do.
    // Turning one of them off lifts the limit for the 4th.
    const a = await expand(page, IDS.a);
    await a.panel.getByRole("button", { name: "Feature this link", exact: true }).click();
    await expectDraft(user.pageId, (doc) => !("featured" in draftBlock(doc, IDS.a)!));
    const d2 = await expand(page, IDS.d);
    await expect(
      d2.panel.getByRole("button", { name: "Feature this link", exact: true }),
    ).toBeEnabled();
    await expect(d2.panel.getByText(sentence)).toHaveCount(0);
    await d2.panel.getByRole("button", { name: "Feature this link", exact: true }).click();
    await expectDraft(user.pageId, (doc) => draftBlock(doc, IDS.d)!.featured === "bold");

    // Three again: a featured link can always be turned off, a fourth cannot be turned on.
    const a2 = await expand(page, IDS.a);
    await expect(
      a2.panel.getByRole("button", { name: "Feature this link", exact: true }),
    ).toBeDisabled();
    await expect(a2.panel.getByText(sentence)).toBeVisible();
    const b = await expand(page, IDS.b);
    await expect(
      b.panel.getByRole("button", { name: "Feature this link", exact: true }),
    ).toBeEnabled();
  });

  test("M6-22 Publish refuses a fourth featured link, names it, and writes nothing", async ({
    page,
    context,
  }) => {
    const ids = ["Lk-five-0001", "Lk-five-0002", "Lk-five-0003", "Lk-five-0004", "Lk-five-0005"];
    const user = await userWithDraft(context, "if3", (h) =>
      draftOf(
        h,
        ids.map((id) => link(id, { featured: "bold" })),
      ),
    );
    await openEditor(page);
    await publishButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Fix 2 blocks before publishing.");
    await expect(alert).toContainText("Feature up to 3 links. Turn one off to feature another.");
    expect(
      await adminClient()
        .from("pages")
        .select("published, published_at")
        .eq("id", user.pageId)
        .single()
        .then((r) => r.data),
    ).toEqual({ published: null, published_at: null });

    // Rows 4 and 5 carry the message under the switch; rows 1 to 3 do not.
    for (const id of ids.slice(3)) {
      const { panel } = await expand(page, id);
      await expect(panel.locator('p[data-field="featured"]')).toHaveText(
        "Feature up to 3 links. Turn one off to feature another.",
      );
    }
    await expect(rowOf(page, ids[0]!)).not.toContainText("Feature up to 3 links");
    // Turning the 4th and the 5th off clears the refusal and Publish works.
    for (const id of ids.slice(3)) {
      const { panel } = await expand(page, id);
      await panel.getByRole("button", { name: "Feature this link", exact: true }).click();
    }
    await expect(page.locator('p[data-field="featured"]')).toHaveCount(0);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });
  });
});

test.describe("M6-20 and M6-22 parity after Publish", () => {
  test("M6-20 the editor preview and the live page draw the same markup for icon, thumbnail and featured links; changing an icon flips the chip", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ip1", (h) => draftOf(h, []));
    const thumb = await uploadImage(user.userId, 400, 400);
    await setDraft(
      user.pageId,
      draftOf(user.handle, [
        link(IDS.a, { icon: { type: "builtin", name: "calendar" } }),
        link(IDS.b, { icon: { type: "image", image: thumb } }),
        link(IDS.c, {
          featured: "pulse",
          icon: { type: "builtin", name: "heart" },
          overrides: { accent: "#C46A4F" },
        }),
        link(IDS.d, { featured: "shine", label: "Soft shine, no icon" }),
        link(IDS.e),
      ]),
    );
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 60_000,
    });

    const inEditor: Record<string, string> = {};
    await inPreviewSheet(page, async () => {
      for (const id of Object.values(IDS)) inEditor[id] = await markupOf(previewLink(page, id));
    });

    const live = await context.newPage();
    await live.goto(url(user.handle));
    await expect(live.locator(".pg-link")).toHaveCount(5);
    for (const id of Object.values(IDS)) {
      const html = await markupOf(live.locator(`.pg-link[data-block-id="${id}"]`));
      expect(html, id).toBe(inEditor[id]);
      // The link still goes through /r/<pageId>/<blockId>.
      expect(html).toContain(`href="/r/${user.pageId}/${id}"`);
    }
    await live.close();

    // A change of icon is an unpublished change.
    const { field } = await expand(page, IDS.a);
    await choose(field).click();
    await iconPanel(field).getByRole("button", { name: "Music", exact: true }).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    // ...and putting it back restores Published (the state is computed from the data).
    await iconPanel(field).getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
    // Featuring a link is one too.
    const e = await expand(page, IDS.e);
    await e.panel.getByRole("button", { name: "Feature this link", exact: true }).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
  });
});
