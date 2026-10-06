import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { addBlock, expectDraft, showView } from "../m2/blocks-helpers";
import {
  box,
  isPhone,
  openEditor,
  panelOf,
  previewScreen,
  rowOf,
  rowToggle,
  stubThirdParties,
  userWithBlocks,
} from "./embeds-helpers";

test.afterAll(cleanupUsers);

/**
 * M6-26 and M6-27 in the editor: what the embed form says it recognized, the two messages and how
 * they lay out, and the preview's tap-to-play. Every test makes its own user.
 */

const GENERAL =
  "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.";
const SHORT =
  "That’s a short link. Open it in your browser, then copy the full address from the address bar.";

const EMBED_ID = "emb-editor-0001";
const embed = (url = "", caption = "Studio reel") => ({
  id: EMBED_ID,
  type: "embed",
  visible: true,
  url,
  caption,
});

const HINTS: [string, string][] = [
  ["https://youtu.be/aqz-KE-bpKQ", "YouTube video"],
  ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "Spotify track"],
  ["https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M", "Spotify album"],
  ["https://vimeo.com/76979871", "Vimeo video"],
  ["https://www.tiktok.com/@mara/video/7234567890123456789", "TikTok video"],
  ["https://www.instagram.com/p/CxYz12AbCde/", "Instagram post"],
  ["https://www.instagram.com/reel/CxYz12AbCde/", "Instagram reel"],
  ["https://soundcloud.com/mara/night-market-mix", "SoundCloud track"],
  ["https://soundcloud.com/mara/sets/field-recordings", "SoundCloud playlist"],
  ["https://soundcloud.com/mara", "SoundCloud artist"],
  ["https://music.apple.com/us/album/the-album/1440857781", "Apple Music album"],
  ["https://music.apple.com/us/album/the-album/1440857781?i=1440857790", "Apple Music song"],
  ["https://music.apple.com/us/playlist/todays-hits/pl.u-d2b05GGOK1Zm0", "Apple Music playlist"],
  ["https://www.twitch.tv/mara_plays", "Twitch channel"],
  ["https://www.twitch.tv/videos/123456789", "Twitch video"],
  ["https://clips.twitch.tv/FamousHappyCaterpillar-AbCd", "Twitch clip"],
];

test.describe("M6-26 and M6-27 the embed form", () => {
  test("M6-27 the hint under the URL field names what was recognized, for every kind", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "emh", [embed()]);
    await openEditor(page);
    await rowToggle(page, EMBED_ID).click();
    const panel = panelOf(page, EMBED_ID);
    const field = panel.locator('input[data-field="url"]');
    for (const [address, hint] of HINTS) {
      await field.fill(address);
      await expect(panel.getByText(hint, { exact: true }), address).toBeVisible();
    }
    // Nothing recognized, nothing named.
    await field.fill("https://evil.example/x");
    for (const [, hint] of HINTS.slice(0, 3))
      await expect(panel.getByText(hint, { exact: true })).toHaveCount(0);
  });

  test("M6-26 a link that does not parse shows the general sentence; a short link says so instead", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "ems", [embed()]);
    await openEditor(page);
    await rowToggle(page, EMBED_ID).click();
    const panel = panelOf(page, EMBED_ID);
    const field = panel.locator('input[data-field="url"]');

    for (const bad of [
      "https://vimeo.com.evil.example/123456",
      "https://www.tiktok.com/@mara",
      "https://soundcloud.com/discover",
      "https://www.twitch.tv/directory",
      "https://evil.example/x",
      "javascript:alert(1)",
    ]) {
      await field.fill(bad);
      await field.blur();
      await expect(panel.getByText(GENERAL, { exact: true }), bad).toBeVisible();
      await expect(panel.getByText(SHORT, { exact: true }), bad).toHaveCount(0);
      await expect(field).toHaveAttribute("aria-invalid", "true");
    }
    for (const short of [
      "https://vm.tiktok.com/ZMabc123/",
      "https://vt.tiktok.com/ZSabc123/",
      "https://www.tiktok.com/t/ZTabc123/",
      "https://on.soundcloud.com/abc123",
      "https://spotify.link/abc123",
      "https://instagr.am/p/CxYz12AbCde",
    ]) {
      await field.fill(short);
      await field.blur();
      await expect(panel.getByText(SHORT, { exact: true }), short).toBeVisible();
      await expect(panel.getByText(GENERAL, { exact: true }), short).toHaveCount(0);
    }
    // A valid address clears it.
    await field.fill("https://vimeo.com/76979871");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await expect(panel.getByText(SHORT, { exact: true })).toHaveCount(0);
  });

  test("M6-26 layout: the longest messages wrap under the field, 16px text, 44px tall, no sideways scroll", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "eml", [embed()]);
    await openEditor(page);
    await rowToggle(page, EMBED_ID).click();
    const panel = panelOf(page, EMBED_ID);
    const field = panel.locator('input[data-field="url"]');
    const caption = panel.locator('input[data-field="caption"]');
    // Positions relative to the panel: the first focus scrolls the block into view.
    const offset = async () => {
      const [c, p] = [await box(caption), await box(panel)];
      return { x: c.x - p.x, y: c.y - p.y, height: c.height };
    };
    await page.waitForTimeout(400);
    const captionBefore = await offset();

    await field.fill("https://evil.example/x");
    await field.blur();
    const general = panel.getByText(GENERAL, { exact: true });
    await expect(general).toBeVisible();
    await expectNoHorizontalScroll(page);
    const fieldBox = await box(field);
    expect(fieldBox.height).toBeGreaterThanOrEqual(44);
    expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    const generalBox = await box(general);
    // Under the field, wrapped to its width.
    expect(generalBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1);
    expect(generalBox.x + generalBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (isPhone(page)) {
      const lineHeight = await general.evaluate(
        (el) => parseFloat(getComputedStyle(el).lineHeight) || 20,
      );
      expect(generalBox.height, "the sentence wraps on a phone").toBeGreaterThan(lineHeight * 1.5);
    }

    await field.fill("https://vm.tiktok.com/ZMabc123/");
    await field.blur();
    const short = panel.getByText(SHORT, { exact: true });
    await expect(short).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect((await box(field)).height).toBeGreaterThanOrEqual(44);
    expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");

    if (!isPhone(page)) {
      // The expanded block is at most 720px wide, and the message does not move the Caption field.
      const panelBox = await box(panel);
      expect(panelBox.width).toBeLessThanOrEqual(720.5);
      const shortBox = await box(short);
      expect(shortBox.x + shortBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
      const captionAfter = await offset();
      expect(captionAfter.y).toBeCloseTo(captionBefore.y, 0);
      expect(captionAfter.x).toBeCloseTo(captionBefore.x, 0);
      expect(captionAfter.height).toBeCloseTo(captionBefore.height, 0);
    }
  });

  test("M6-27 the default caption of a new embed is still 'Video or music'", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "emd", []);
    await openEditor(page);
    const { panel, id } = await addBlock(page, "embed");
    await expect(panel.locator('input[data-field="caption"]')).toHaveValue("Video or music");
    await expect(rowOf(page, id)).toContainText("Video or music");
  });
});

test.describe("M6-27 the preview plays like the live page", () => {
  test("M6-27 a tap on a facade in the preview mounts the iframe in the editor, and a new address updates it at once", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "emp", [
      embed("https://www.twitch.tv/mara_plays", "Live now"),
    ]);
    await stubThirdParties(context);
    await openEditor(page);

    await showView(page, "Preview");
    const screen = previewScreen(page);
    const facade = screen.getByRole("button", { name: "Watch stream: Live now" });
    await expect(facade).toBeVisible();
    await facade.click();
    const frame = screen.locator("iframe");
    await expect(frame).toHaveCount(1);
    // Still the editor; Twitch's parent is the app host.
    expect(page.url()).toContain("app.localhost");
    expect(await frame.getAttribute("src")).toBe(
      "https://player.twitch.tv/?channel=mara_plays&autoplay=true&parent=app.localhost",
    );

    // Switch the address to another provider: the facade of that provider replaces the player at once.
    await showView(page, "Blocks");
    await rowToggle(page, EMBED_ID).click();
    await panelOf(page, EMBED_ID)
      .locator('input[data-field="url"]')
      .fill("https://soundcloud.com/mara/night-market-mix");
    await showView(page, "Preview");
    await expect(screen.locator("iframe")).toHaveCount(0);
    await expect(screen.getByRole("button", { name: "Play music: Live now" })).toBeVisible();
    await expect(screen.locator(".pg-embed-caption")).toHaveText("Live now · SoundCloud");
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) => b.id === EMBED_ID && b.type === "embed" && b.url.includes("soundcloud.com"),
      ),
    );

    // And back to a video provider: 16:9 again.
    await showView(page, "Blocks");
    await panelOf(page, EMBED_ID)
      .locator('input[data-field="url"]')
      .fill("https://vimeo.com/76979871");
    await showView(page, "Preview");
    const vimeo = screen.getByRole("button", { name: "Play video: Live now" });
    await expect(vimeo).toBeVisible();
    const b = await box(vimeo);
    expect(Math.abs(b.width / b.height - 16 / 9)).toBeLessThan(0.05);
  });
});
