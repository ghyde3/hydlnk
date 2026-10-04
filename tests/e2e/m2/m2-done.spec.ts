import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { confirmPhoto } from "../m6/position-dialog-helpers";
import { addBlock, expectDraft, rowOf, showView } from "./blocks-helpers";
import { emptyUser, openEditor, pageRow, previewScreen, statusChip } from "./editor-helpers";

/**
 * M2-31, the milestone's done-when flow, through the real editor UI at both viewports (phone
 * 390x844 and desktop 1440x900 run in parallel, so each project signs up its own user and handle
 * instead of sharing mara's draft: two contexts autosaving one draft trip the stale-tab guard).
 *
 *   empty draft -> name, bio, photo -> one block of each of the nine types (a tenth, hidden) ->
 *   Publish -> the preview and the live page agree block for block -> the live page fits 390 and
 *   1440 -> an edit after Publish shows in the preview and in the chip, not on the live page, until
 *   the next Publish.
 *
 * Step 3 (one renderer, not two) is Vitest: tests/unit/renderer-parity.test.ts. Step 9 is the
 * suite itself. The production halves of the milestone (a Vercel deploy, the cache) are not here.
 */

test.afterAll(cleanupUsers);

const NAME = "Mara Okafor";
const BIO = "Portrait and studio photographer based in Orlando.";
const BLOCK_TYPES = [
  "link",
  "card",
  "header",
  "text",
  "image",
  "social",
  "embed",
  "grid",
  "divider",
] as const;
const HIDDEN_TEXT = "HIDDEN-ZQ-7f3a never goes live";

const publishButton = (page: Page) => page.getByRole("button", { name: /^Publish/ });

/** A real 400x400 JPEG, drawn in the browser (the upload route sniffs magic bytes and header). */
async function jpeg400(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#C46A4F";
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = "#1C1B1A";
    ctx.fillRect(100, 100, 200, 200);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  const buffer = Buffer.from(base64, "base64");
  expect(buffer.subarray(0, 3).toString("hex"), "a JPEG (FF D8 FF)").toBe("ffd8ff");
  return buffer;
}

interface BlockSummary {
  id: string | null;
  type: string | null;
  text: string;
  hrefs: (string | null)[];
  srcs: (string | null)[];
}

/** What step 4 compares: id, type, text, and every href and src inside each block. */
function summarize(scope: Locator): Promise<BlockSummary[]> {
  return scope.locator("[data-block-id]").evaluateAll((elements) =>
    elements.map((element) => {
      const all = [element, ...Array.from(element.querySelectorAll("*"))];
      return {
        id: element.getAttribute("data-block-id"),
        type: element.getAttribute("data-block-type"),
        text: element.textContent ?? "",
        hrefs: all.filter((n) => n.hasAttribute("href")).map((n) => n.getAttribute("href")),
        srcs: all.filter((n) => n.hasAttribute("src")).map((n) => n.getAttribute("src")),
      };
    }),
  );
}

/** The live page's layout at one viewport (steps 5 and 6). */
async function expectLiveLayout(page: Page, width: number, height: number, handle: string) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(url(handle));
  expect(response?.status()).toBe(200);
  const root = page.locator("[data-page-root]");
  await expect(root).toBeVisible();
  await expectNoHorizontalScroll(page);

  for (const type of BLOCK_TYPES) {
    await expect(root.locator(`[data-block-type="${type}"]`), `${type} at ${width}px`).toHaveCount(
      1,
    );
    await expect(root.locator(`[data-block-type="${type}"]`).first()).toBeVisible();
  }
  const badge = page.getByRole("link", { name: "Made with HYDLNK" });
  const report = page.getByRole("link", { name: "Report this page" });
  await expect(badge).toBeVisible();
  await expect(report).toBeVisible();

  const geometry = await page.evaluate(() => {
    const rootEl = document.querySelector("[data-page-root]")!;
    const rect = rootEl.getBoundingClientRect();
    const column = rootEl.querySelector(".pg-column")!.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      root: { left: rect.left, right: rect.right, height: rect.height },
      column: { left: column.left, right: column.right, width: column.width },
      background: getComputedStyle(rootEl).backgroundColor,
    };
  });
  // The background fills the viewport edge to edge, the column is capped and centered.
  expect(geometry.root.left).toBeLessThanOrEqual(0.5);
  expect(geometry.root.right).toBeGreaterThanOrEqual(geometry.innerWidth - 0.5);
  expect(geometry.root.height).toBeGreaterThanOrEqual(geometry.innerHeight);
  expect(geometry.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(geometry.column.width).toBeLessThanOrEqual(480.5);
  const margins = [geometry.column.left, geometry.innerWidth - geometry.column.right];
  expect(Math.abs(margins[0]! - margins[1]!)).toBeLessThanOrEqual(1);

  if (width <= 480) {
    // Phone: every link, button, social icon and grid cell is at least 44px in both dimensions.
    await expectTapTargets(page, "[data-page-root]");
    for (const anchor of [badge, report]) {
      const box = (await anchor.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  }

  mkdirSync("tmp/screens", { recursive: true });
  await page.screenshot({ path: `tmp/screens/m2-done-live-${width}.png`, fullPage: true });
}

test("M2-31 a page with every block type renders identically in preview and live at 390px and 1440px", async ({
  page,
  context,
}, info) => {
  test.setTimeout(240_000);
  const user = await emptyUser(context, "md");
  const liveUrl = url(user.handle);

  // 1. Setup: name, bio and a 400x400 JPG photo, then one block of each type through the chips.
  await openEditor(page);
  await page.getByLabel("Display name", { exact: true }).fill(NAME);
  await page.getByLabel("Bio", { exact: true }).fill(BIO);
  const profile = page.getByRole("region", { name: "Profile", exact: true });
  await profile.locator("input[type=file]").setInputFiles({
    name: "mara.jpg",
    mimeType: "image/jpeg",
    buffer: await jpeg400(page),
  });
  // M6-24: choosing a photo opens the position dialog; the upload starts at "Use photo".
  await confirmPhoto(page);
  await expect(profile.getByRole("button", { name: "Replace photo" })).toBeVisible({
    timeout: 25_000,
  });

  const ids: Record<string, string> = {};

  let added = await addBlock(page, "link");
  ids.link = added.id;
  await added.panel.getByLabel("Label", { exact: true }).fill("Portrait sessions - fall dates");
  await added.panel.getByLabel("Link", { exact: true }).fill("https://maraokafor.com/portraits");

  added = await addBlock(page, "card");
  ids.card = added.id;
  await added.panel.getByLabel("Title", { exact: true }).fill("Night Market prints");
  await added.panel.getByLabel("Caption", { exact: true }).fill("Limited run");
  await added.panel.getByLabel("Link", { exact: true }).fill("https://maraokafor.com/prints");
  await added.panel.locator('input[type="file"]').setInputFiles({
    name: "card.jpg",
    mimeType: "image/jpeg",
    buffer: await jpeg400(page),
  });
  await expect(added.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
    timeout: 25_000,
  });

  added = await addBlock(page, "header");
  ids.header = added.id;
  await added.panel.getByLabel("Text", { exact: true }).fill("Book a session");

  added = await addBlock(page, "text");
  ids.text = added.id;
  await added.panel
    .getByLabel("Text", { exact: true })
    .fill("Shooting on film and digital.\nBased in Orlando, travelling worldwide.");

  added = await addBlock(page, "image");
  ids.image = added.id;
  await added.panel.locator('input[type="file"]').setInputFiles({
    name: "studio.jpg",
    mimeType: "image/jpeg",
    buffer: await jpeg400(page),
  });
  await expect(added.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
    timeout: 25_000,
  });
  await added.panel.getByLabel("Alt text", { exact: true }).fill("The studio in the morning");
  await added.panel
    .getByLabel("Link (optional)", { exact: true })
    .fill("https://maraokafor.com/studio");

  added = await addBlock(page, "social");
  ids.social = added.id;
  const icons = added.panel.getByRole("group");
  await icons.nth(0).getByLabel("Link", { exact: true }).fill("https://instagram.com/maraokafor");
  await added.panel.getByRole("button", { name: "Add icon" }).click();
  await expect(icons).toHaveCount(2);
  await expect(icons.nth(1).getByRole("combobox", { name: "Platform" })).toHaveValue("tiktok");
  await icons.nth(1).getByLabel("Link", { exact: true }).fill("https://tiktok.com/@maraokafor");
  await added.panel.getByRole("button", { name: "Add icon" }).click();
  await expect(icons).toHaveCount(3);
  await expect(icons.nth(2).getByRole("combobox", { name: "Platform" })).toHaveValue("youtube");
  await icons.nth(2).getByLabel("Link", { exact: true }).fill("https://youtube.com/@maraokafor");
  await added.panel.getByRole("button", { name: "Add icon" }).click();
  await expect(icons).toHaveCount(4);
  await icons.nth(3).getByRole("combobox", { name: "Platform" }).selectOption("email");
  await icons.nth(3).getByLabel("Email address").fill("hello@maraokafor.com");

  added = await addBlock(page, "embed");
  ids.embed = added.id;
  await added.panel.getByLabel("Caption", { exact: true }).fill("Behind the scenes");
  await added.panel
    .getByLabel("Link", { exact: true })
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  added = await addBlock(page, "grid");
  ids.grid = added.id;
  const cells = added.panel.getByRole("group");
  await expect(cells).toHaveCount(2);
  await cells.nth(0).getByLabel("Title", { exact: true }).fill("Prints");
  await cells.nth(0).getByLabel("Subtitle", { exact: true }).fill("Signed and numbered");
  await cells.nth(0).getByLabel("Link", { exact: true }).fill("https://maraokafor.com/prints");
  await cells.nth(1).getByLabel("Title", { exact: true }).fill("Workshops");
  await cells.nth(1).getByLabel("Subtitle", { exact: true }).fill("Small groups");
  await cells.nth(1).getByLabel("Link", { exact: true }).fill("https://maraokafor.com/workshops");

  added = await addBlock(page, "divider");
  ids.divider = added.id;

  // One more text block, hidden: it must reach neither the preview nor the live page.
  added = await addBlock(page, "text");
  ids.hidden = added.id;
  await added.panel.getByLabel("Text", { exact: true }).fill(HIDDEN_TEXT);
  await rowOf(page, ids.hidden!).getByRole("button", { name: "Visible on page" }).click();
  await expect(
    rowOf(page, ids.hidden!).getByRole("button", { name: "Visible on page" }),
  ).toHaveAttribute("aria-pressed", "false");

  const saved = await expectDraft(
    user.pageId,
    (d) =>
      d.blocks.length === 10 &&
      d.blocks.some((b) => b.id === ids.hidden && b.visible === false) &&
      d.profile.photo !== null,
    "all ten blocks and the photo are saved",
  );
  expect(saved.blocks.slice(0, 9).map((b) => b.type)).toEqual([...BLOCK_TYPES]);
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "not-published");

  // 2. Publish: the chip reads Published, `published` is set and the live page answers 200.
  await publishButton(page).click();
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
    timeout: 30_000,
  });
  await expect(statusChip(page)).toHaveText("Published");
  const row = await pageRow(user.pageId);
  expect(row.published).not.toBeNull();
  expect(row.published_at).not.toBeNull();
  expect(row.draft.blocks).toHaveLength(10);
  const publishedBlocks = (row.published as { blocks: { id: string; type: string }[] }).blocks;
  expect(publishedBlocks.map((b) => b.type)).toEqual([...BLOCK_TYPES]);
  const raw = await rawRequest(`${user.handle}.localhost:3000`, "/");
  expect(raw.status).toBe(200);
  expect(raw.body).not.toContain(HIDDEN_TEXT);
  expect(JSON.stringify(row.published)).not.toContain(HIDDEN_TEXT);

  // 4. Parity: the preview pane and the live page carry the same nine blocks, in the same order,
  //    with the same text, hrefs and srcs. The hidden block is in neither, the avatar is the photo.
  await showView(page, "Preview");
  const live = await context.newPage();
  await live.goto(liveUrl);
  await expect(live.locator("[data-page-root] [data-block-id]")).toHaveCount(9);
  await expect(previewScreen(page).locator("[data-block-id]")).toHaveCount(9);

  const previewBlocks = await summarize(previewScreen(page));
  const liveBlocks = await summarize(live.locator("[data-page-root]"));
  expect(previewBlocks.map((b) => b.type)).toEqual([...BLOCK_TYPES]);
  expect(liveBlocks.map((b) => b.id)).toEqual(previewBlocks.map((b) => b.id));
  expect(liveBlocks.map((b) => b.type)).toEqual(previewBlocks.map((b) => b.type));
  expect(liveBlocks.map((b) => b.text)).toEqual(previewBlocks.map((b) => b.text));
  expect(liveBlocks.map((b) => b.hrefs)).toEqual(previewBlocks.map((b) => b.hrefs));
  expect(liveBlocks.map((b) => b.srcs)).toEqual(previewBlocks.map((b) => b.srcs));
  for (const text of [HIDDEN_TEXT]) {
    await expect(previewScreen(page)).not.toContainText(text);
    await expect(live.locator("[data-page-root]")).not.toContainText(text);
  }
  // Both draw the same avatar: the uploaded photo, named by the display name.
  const avatarOf = (scope: Locator) => scope.locator(`img[alt="${NAME}"]`).first();
  const previewAvatar = avatarOf(previewScreen(page));
  const liveAvatar = avatarOf(live.locator("[data-page-root]"));
  await expect(previewAvatar).toBeVisible();
  await expect(liveAvatar).toBeVisible();
  const photoPath = (row.draft.profile.photo as { path: string }).path;
  expect(await previewAvatar.getAttribute("src")).toContain(photoPath);
  expect(await liveAvatar.getAttribute("src")).toBe(await previewAvatar.getAttribute("src"));
  await expect(previewScreen(page).getByRole("heading", { level: 1 })).toHaveText(NAME);
  await expect(live.getByRole("heading", { level: 1 })).toHaveText(NAME);

  // 7. The editor at the project's viewport: on a phone the preview sheet shows the nine blocks, no
  //    bezel, no sideways scroll, and Publish is a 44px target; on desktop the bezel holds them.
  await expectNoHorizontalScroll(page);
  expect((await publishButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (phoneOnly(info)) {
    // M7-09: the sheet (opened above) shows the page at full width with no bezel.
    await expect(page.getByRole("dialog", { name: "Live preview" })).toBeVisible();
    await expect(page.getByTestId("preview-bezel")).toHaveCount(0);
    await showView(page, "Blocks");
    await showView(page, "Preview");
    expect(await summarize(previewScreen(page))).toHaveLength(9);
  } else if (desktopOnly(info)) {
    const bezelBox = (await page.getByTestId("preview-bezel").boundingBox())!;
    expect(bezelBox.width).toBe(310);
  }

  // 5 and 6. The live page fits 1440x900 and 390x844: all nine block types visible, the badge and
  //    the report link too, no sideways scroll, the column capped and centered, the background
  //    edge to edge, and 44px targets on the phone. Run at both sizes in both projects.
  await expectLiveLayout(live, 1440, 900, user.handle);
  await expectLiveLayout(live, 390, 844, user.handle);

  // 8. Change after Publish: the chip flips, the preview shows the new bio at once, the live page
  //    keeps the old one; Publish, and an immediate reload of the live page shows the new bio.
  const newBio = `${BIO} Now booking spring.`;
  await showView(page, "Blocks");
  await page.getByLabel("Bio", { exact: true }).fill(newBio);
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
  await showView(page, "Preview");
  await expect(previewScreen(page)).toContainText(newBio);
  const stale = await rawRequest(`${user.handle}.localhost:3000`, "/");
  expect(stale.body).toContain(BIO);
  expect(stale.body).not.toContain("Now booking spring.");

  await showView(page, "Blocks"); // a phone closes the preview sheet, which covers the toolbar
  await publishButton(page).click();
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
    timeout: 30_000,
  });
  await live.reload();
  await expect(live.locator("[data-page-root]")).toContainText("Now booking spring.");
  expect((await rawRequest(`${user.handle}.localhost:3000`, "/")).body).toContain(
    "Now booking spring.",
  );
});
