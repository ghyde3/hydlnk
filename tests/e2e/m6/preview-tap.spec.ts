import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { adminClient } from "../fixtures/auth";
import { newBlockId, type Block } from "@/lib/document";
import { draftOf } from "../m2/blocks-helpers";
import {
  blockSet,
  box,
  closeSheet,
  css,
  inPreview,
  miniPhone,
  nameInput,
  openEditor,
  panelOf,
  previewScreen,
  rowOf,
  rowToggle,
  sheet,
  textBlocks,
  trackingRequests,
  userWithBlocks,
} from "./preview-helpers";

/** M6-03: tap anything in the preview to edit it. */

test.afterAll(cleanupUsers);

const FIRST_FIELD = "input:not([type=file]):not([type=hidden]), textarea, select";
/** A profile with a bio: without one the page draws no bio to tap. */
const WITH_BIO = { profile: { name: "Tap Test", bio: "A short bio", photo: null } } as never;
const bioInput = (page: Page) => page.getByLabel("Bio", { exact: true });

/** Row `id` is the only open one, and focus is in its first field (a divider: on the row itself). */
async function expectOpened(page: Page, id: string, divider = false) {
  await expect(rowToggle(page, id)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("li[data-block-id] button[aria-expanded=true]")).toHaveCount(1);
  if (divider) await expect(rowOf(page, id)).toBeFocused();
  else await expect(panelOf(page, id).locator(FIRST_FIELD).first()).toBeFocused();
}

/** Closes every open row, so the next tap has to open one. */
async function closeRows(page: Page) {
  for (const toggle of await page.locator("li[data-block-id] button[aria-expanded=true]").all()) {
    await toggle.click();
  }
  await expect(page.locator("li[data-block-id] button[aria-expanded=true]")).toHaveCount(0);
}

test.describe("M6-03 desktop: tap a block, an item or the profile in the bezel", () => {
  test("M6-03 every block type opens its row, collapses the others, focuses its first field and does not follow the link", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await userWithBlocks(context, "tp1", (userId) => blockSet(userId).blocks);
    const tracked = trackingRequests(page);
    const popups: unknown[] = [];
    context.on("page", (p) => popups.push(p));
    await openEditor(page);
    const start = page.url();

    const byType = (type: string, nth = 0) => user.blocks.filter((b) => b.type === type)[nth]!;
    const cases: { name: string; id: string; target: string; divider?: boolean }[] = [
      { name: "link", id: byType("link").id, target: "" },
      { name: "card", id: byType("card").id, target: "" },
      { name: "header", id: byType("header").id, target: "" },
      { name: "text", id: byType("text").id, target: "" },
      { name: "image", id: byType("image").id, target: "" },
      { name: "social", id: byType("social").id, target: "" },
      { name: "grid", id: byType("grid").id, target: "" },
      { name: "divider", id: byType("divider").id, target: "", divider: true },
      { name: "empty image", id: byType("image", 1).id, target: ".pg-placeholder" },
      { name: "empty embed", id: byType("embed", 1).id, target: ".pg-placeholder" },
    ];
    for (const item of cases) {
      const block = inPreview(page, item.id);
      // A placeholder carries the block id itself; social and grid are tapped at their own edge,
      // not on an item.
      const target =
        item.target === ".pg-placeholder"
          ? block
          : item.target
            ? block.locator(item.target)
            : block;
      await target.click(
        item.name === "social"
          ? { position: { x: 2, y: 2 } }
          : item.name === "grid"
            ? { position: { x: 1, y: 1 } }
            : {},
      );
      await expectOpened(page, item.id, item.divider);
      expect(page.url(), item.name).toBe(start);
      // Tappable preview elements show a pointer.
      expect(await css(block, "cursor"), item.name).toBe("pointer");
      await closeRows(page);
    }
    expect(tracked).toEqual([]);
    expect(popups).toEqual([]);
    // Nothing mounted a player so far.
    await expect(previewScreen(page).locator("iframe")).toHaveCount(0);
    // M6-27 supersedes this step of M6-03 for a facade's Play button: it plays in the preview, like
    // on the live page, and does not open the block.
    const embed = byType("embed").id;
    await inPreview(page, embed).locator(".pg-embed-play").click();
    await expect(inPreview(page, embed).locator("iframe")).toHaveCount(1);
    await expect(rowToggle(page, embed)).toHaveAttribute("aria-expanded", "false");
    expect(page.url()).toBe(start);
  });

  test("M6-03 a card, a link, an image and a grid in a row collapse the one that was open", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await userWithBlocks(context, "tp2", (userId) => blockSet(userId).blocks);
    await openEditor(page);
    const [link, card] = [user.blocks[0]!.id, user.blocks[1]!.id];
    await inPreview(page, link).click();
    await expectOpened(page, link);
    await inPreview(page, card).click();
    await expectOpened(page, card);
    await expect(rowToggle(page, link)).toHaveAttribute("aria-expanded", "false");
  });

  test("M6-03 the profile: the avatar focuses Upload photo, the name Display name, the bio Bio", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await userWithBlocks(context, "tp3", () => textBlocks(2), { extra: WITH_BIO });
    await openEditor(page);
    const part = (name: string) => previewScreen(page).locator(`[data-profile-part="${name}"]`);
    await part("avatar").click();
    await expect(page.getByRole("button", { name: /^(Upload|Replace) photo/ })).toBeFocused();
    await part("name").click();
    await expect(nameInput(page)).toBeFocused();
    await part("bio").click();
    await expect(bioInput(page)).toBeFocused();
    expect(await css(part("name"), "cursor")).toBe("pointer");
  });

  test("M6-03 a social icon and a grid cell open their block and focus that item's first field", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await userWithBlocks(context, "tp4", (userId) => blockSet(userId).blocks);
    const social = user.blocks.find((b) => b.type === "social")!;
    const grid = user.blocks.find((b) => b.type === "grid")!;
    const iconB = social.type === "social" ? social.icons[1]!.id : "";
    const cellB = grid.type === "grid" ? grid.cells[1]!.id : "";
    await openEditor(page);

    await inPreview(page, iconB).click();
    await expect(rowToggle(page, social.id)).toHaveAttribute("aria-expanded", "true");
    const iconCard = panelOf(page, social.id).locator(`[data-item-id="${iconB}"]`);
    await expect(iconCard.locator(FIRST_FIELD).first()).toBeFocused();

    await inPreview(page, cellB).click();
    await expect(rowToggle(page, grid.id)).toHaveAttribute("aria-expanded", "true");
    await expect(rowToggle(page, social.id)).toHaveAttribute("aria-expanded", "false");
    const cellCard = panelOf(page, grid.id).locator(`[data-item-id="${cellB}"]`);
    await expect(cellCard.getByLabel("Title", { exact: true })).toBeFocused();
    expect(await css(inPreview(page, cellB), "cursor")).toBe("pointer");
  });

  test("M6-03 a Spotify poster and a YouTube poster both play in place, and neither swallows a tap on the rest of the block (M6-27, M8-05)", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const spotify: Block = {
      id: newBlockId(),
      type: "embed",
      visible: true,
      url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      caption: "Tap song",
    } as Block;
    const youtube: Block = {
      id: newBlockId(),
      type: "embed",
      visible: true,
      url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      caption: "Tap video",
    } as Block;
    await userWithBlocks(context, "tp5", () => [spotify, youtube]);
    await openEditor(page);
    // M8-05: Spotify is a facade like the others, so there is no iframe until a tap, and a tap on its
    // poster plays it in place (as on the live page) and does not open the block.
    const poster = previewScreen(page).locator(`[data-block-id="${spotify.id}"] .pg-embed-play`);
    await expect(previewScreen(page).locator(`[data-block-id="${spotify.id}"] iframe`)).toHaveCount(0);
    expect((await poster.boundingBox())!.height).toBe(152);
    await poster.click();
    const frame = previewScreen(page).locator(`[data-block-id="${spotify.id}"] iframe`);
    await expect(frame).toHaveCount(1);
    expect(await css(frame, "pointer-events")).toBe("none");
    await expect(rowToggle(page, spotify.id)).toHaveAttribute("aria-expanded", "false");
    // Once playing, a tap on the player's own area is a tap on the block: it opens its row.
    await frame.click({ force: true });
    await expectOpened(page, spotify.id);
    await closeRows(page);
    // M6-27 supersedes this step of M6-03: a facade's Play button plays in the preview, like on the
    // live page, and does not open the block.
    await previewScreen(page).locator(`[data-block-id="${youtube.id}"] .pg-embed-play`).click();
    await expect(previewScreen(page).locator(`[data-block-id="${youtube.id}"] iframe`)).toHaveCount(
      1,
    );
    await expect(
      previewScreen(page).locator(`[data-block-id="${youtube.id}"] .pg-embed-play`),
    ).toHaveCount(0);
    await expect(rowToggle(page, youtube.id)).toHaveAttribute("aria-expanded", "false");
  });

  test("M6-03 taps that mean nothing do nothing: the background, empty space and the footer links", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await userWithBlocks(context, "tp6", () => textBlocks(2)); // free plan: both footer links
    const popups: unknown[] = [];
    context.on("page", (p) => popups.push(p));
    await openEditor(page);
    const start = page.url();
    const tracked = trackingRequests(page);
    const root = previewScreen(page).locator("[data-page-root]");
    await root.click({ position: { x: 10, y: 300 } });
    await previewScreen(page)
      .locator(".pg-column")
      .click({ position: { x: 3, y: 120 } });
    for (const link of await previewScreen(page).locator("[data-page-footer] a").all()) {
      await link.click();
    }
    await page.waitForTimeout(400);
    expect(page.url()).toBe(start);
    expect(popups).toEqual([]);
    expect(tracked).toEqual([]);
    await expect(page.locator("li[data-block-id] button[aria-expanded=true]")).toHaveCount(0);
  });

  test("M6-03 a block with a Publish error opens showing its error; a hidden block cannot be tapped", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await userWithBlocks(context, "tp7", (userId) => blockSet(userId).blocks);
    const empty = user.blocks.filter((b) => b.type === "image")[1]!.id;
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "before publishing" })).toBeVisible();
    await closeRows(page);
    await inPreview(page, empty).click();
    await expect(rowToggle(page, empty)).toHaveAttribute("aria-expanded", "true");
    await expect(
      panelOf(page, empty).locator("[data-field=image], [aria-invalid=true]").first(),
    ).toBeVisible();
    // Hidden blocks are not drawn.
    const link = user.blocks[0]!.id;
    await rowOf(page, link).getByRole("button", { name: "Visible on page" }).click();
    await expect(inPreview(page, link)).toHaveCount(0);
  });

  test("M6-03 abuse: tenant text cannot forge a tap target", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const link: Block = {
      id: newBlockId(),
      type: "link",
      visible: true,
      label: "<i data-block-id='x'>",
      url: "https://example.com/a",
    } as Block;
    const other = textBlocks(1)[0]!;
    const user = await userWithBlocks(context, "tp8", () => [link, other]);
    // The profile name is the forged markup too.
    const { error } = await adminClient()
      .from("pages")
      .update({
        draft: draftOf(user.handle, [link, other], {
          profile: { name: "<b data-profile-part='bio'>", bio: "A real bio", photo: null },
        } as never),
      })
      .eq("id", user.pageId);
    expect(error).toBeNull();
    await openEditor(page);
    const screen = previewScreen(page);
    await expect(screen.locator("[data-block-id='x']")).toHaveCount(0);
    await expect(page.locator("[data-block-id='x']")).toHaveCount(0);
    await expect(screen.locator("a.pg-link")).toHaveText("<i data-block-id='x'>");
    await expect(screen.locator("h1")).toHaveText("<b data-profile-part='bio'>");
    await expect(screen.locator("[data-profile-part=bio]")).toHaveCount(1);
    await expect(screen.locator("[data-profile-part=bio]")).toHaveText("A real bio");
    // A tap on the forged text opens the block and the field it really belongs to.
    await screen.locator("a.pg-link").click();
    await expectOpened(page, link.id);
    await screen.locator("h1").click();
    await expect(nameInput(page)).toBeFocused();
    await expect(bioInput(page)).not.toBeFocused();
  });

  test("M6-03 the list scrolls to the opened row while the preview stays in view", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await userWithBlocks(context, "tp9", () => textBlocks(30));
    const target = user.blocks[24]!.id;
    await openEditor(page);
    const screen = previewScreen(page);
    await screen.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await inPreview(page, target).click();
    await expectOpened(page, target);
    const row = await box(rowOf(page, target));
    expect(row.y).toBeGreaterThanOrEqual(0);
    expect(row.y + row.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const bezel = await box(page.getByTestId("preview-bezel"));
    expect(bezel.y).toBeGreaterThanOrEqual(0);
    expect(bezel.y + bezel.height).toBeLessThanOrEqual(900);
  });
});

test.describe("M6-03 phone: tap on the full-size preview", () => {
  test("M6-03 a tap in the sheet closes it, opens the block's panel, scrolls its row into the middle and focuses its first input", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "tq1", (userId) => blockSet(userId).blocks);
    const grid = user.blocks.find((b) => b.type === "grid")!;
    await openEditor(page);
    await miniPhone(page).click();
    await expect(sheet(page)).toBeVisible();
    await inPreview(page, grid.id).click({ position: { x: 1, y: 1 } });
    await expect(sheet(page)).toHaveCount(0);
    await expectOpened(page, grid.id);
    const field = await box(panelOf(page, grid.id).locator(FIRST_FIELD).first());
    // The focused field is within the middle band of the screen, clear of the mini phone.
    expect(field.y).toBeGreaterThan(844 * 0.15);
    expect(field.y + field.height).toBeLessThan((await box(miniPhone(page))).y + 1);
    const row = await box(rowOf(page, grid.id));
    expect(row.y).toBeLessThan(844);
    expect(row.y + row.height).toBeGreaterThan(0);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-testid='workspace-toolbar'], #workspace-panel");
  });

  test("M6-03 profile taps from the full-size preview land on the right field", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await userWithBlocks(context, "tq2", () => textBlocks(2), { extra: WITH_BIO });
    await openEditor(page);
    for (const [part, focused] of [
      ["bio", bioInput(page)],
      ["name", nameInput(page)],
      ["avatar", page.getByRole("button", { name: /^(Upload|Replace) photo/ })],
    ] as const) {
      await miniPhone(page).click();
      await previewScreen(page).locator(`[data-profile-part="${part}"]`).click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(focused).toBeFocused();
    }
    await expectNoHorizontalScroll(page);
  });

  test("M6-03 a swipe that scrolls the preview opens nothing", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "tq3", () => textBlocks(30));
    await openEditor(page);
    await miniPhone(page).click();
    await expect(closeSheet(page)).toBeVisible();
    // The gesture only scrolls what is there: wait until the last block is drawn and the page is
    // clearly taller than the viewport (on a loaded CI machine the first paint can still be short).
    await expect(
      previewScreen(page).locator(`[data-block-id="${user.blocks.at(-1)!.id}"]`),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const screen = document.querySelector('[data-testid="preview-screen"]')!;
            return screen.scrollHeight - screen.clientHeight;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(300);
    const cdp = await context.newCDPSession(page);
    // What scrolls in the sheet is its own screen (the document behind it is locked); read it, and
    // the window too in case that ever changes.
    const scrolled = () =>
      page.evaluate(() => {
        const screen = document.querySelector('[data-testid="preview-screen"]');
        return Math.max(
          window.scrollY,
          document.scrollingElement?.scrollTop ?? 0,
          screen?.scrollTop ?? 0,
        );
      });
    // A real touch drag, sent as raw touch events (touchStart, many touchMoves, touchEnd). On CI's
    // Linux headless Chrome `Input.synthesizeScrollGesture` alone did not scroll the page; the raw
    // touch pipeline is what a finger does, and it needs no compositor-side gesture controller.
    async function drag(): Promise<void> {
      const x = 195;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: 600 }],
      });
      for (let i = 1; i <= 20; i += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: 600 - i * 20 }],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    let attempt = 0;
    // If the page was not yet ready to take it, swipe again (a few times at most, alternating the
    // two ways of sending a touch scroll). What the test asserts is unchanged: the page scrolled
    // and the swipe opened no block.
    await expect
      .poll(
        async () => {
          attempt += 1;
          if (attempt % 2 === 1) await drag();
          else
            await cdp.send("Input.synthesizeScrollGesture", {
              x: 195,
              y: 600,
              yDistance: -400,
              speed: 800,
              gestureSourceType: "touch",
            });
          await page.waitForTimeout(300);
          return scrolled();
        },
        { timeout: 20_000, intervals: [0, 250, 250] },
      )
      .toBeGreaterThan(100);
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator("li[data-block-id] button[aria-expanded=true]")).toHaveCount(0);
  });

  test("M6-03 the keyboard: Tab reaches the links in the preview and Enter does what a tap does, with no navigation", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await userWithBlocks(context, "tq4", (userId) => blockSet(userId).blocks);
    const link = user.blocks[0]!.id;
    await openEditor(page);
    await miniPhone(page).click();
    await expect(closeSheet(page)).toBeFocused();
    const start = page.url();
    // Tab from Close preview forward until the preview's first link has focus.
    let onLink = false;
    for (let i = 0; i < 12 && !onLink; i += 1) {
      await page.keyboard.press("Tab");
      onLink = await page.evaluate(
        (id) => document.activeElement?.getAttribute("data-block-id") === id,
        link,
      );
    }
    expect(onLink).toBe(true);
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toHaveCount(0);
    await expectOpened(page, link);
    expect(page.url()).toBe(start);
  });
});

test.describe("M6-03 the Design screen's preview is unchanged", () => {
  test("M6-03 tapping a block in the Design preview opens nothing and goes nowhere", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await userWithBlocks(context, "tr1", (userId) => blockSet(userId).blocks);
    await page.goto(url("app", "/design"));
    const screen = page.getByTestId("preview-screen");
    await expect(screen).toBeVisible();
    const start = page.url();
    await screen.locator(".pg-header").first().click();
    await page.waitForTimeout(300);
    expect(page.url()).toBe(start);
    await expect(page.locator("li[data-block-id]")).toHaveCount(0);
    expect(await css(screen.locator(".pg-header").first(), "cursor")).not.toBe("pointer");
  });
});
