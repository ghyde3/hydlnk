import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { Block } from "@/lib/document";
import { publishDocOf, publishedPage, type PublishedTestPage } from "../m2/blocks-helpers";
import { draftWith, emptyUser, setDraft } from "../m2/editor-helpers";

export * from "../m2/editor-helpers";

/** A signed-in user whose one page's draft holds `blocks` (the editor is not opened yet). */
export async function userWithBlocks(
  context: BrowserContext,
  label: string,
  blocks: unknown[],
  opts: { plan?: "free" | "pro" | "studio" } = {},
) {
  const user = await emptyUser(context, label, { plan: opts.plan });
  await setDraft(user.pageId, draftWith(user.handle, blocks));
  return user;
}

/** The button that opens and closes a block's row, and the panel it opens. */
export const rowToggle = (page: Page, blockId: string): Locator =>
  page.locator(`li[data-block-id="${blockId}"] button[aria-expanded]`);
export const panelOf = (page: Page, blockId: string): Locator =>
  page.locator(`#block-panel-${blockId}`);

/**
 * Shared setup for the embed specs (M6-26, M6-27): a page that is live with one embed of each of
 * the eight providers, a stand-in for every third-party host (the specs never reach the internet),
 * and the numbers each facade and player should have.
 */

export interface ProviderCase {
  name: string;
  provider: string;
  id: string;
  url: string;
  caption: string;
  /** The Play button's accessible name. */
  label: string;
  /** The caption under the block. */
  below: string;
  /** Facade height in px, or null for the 16:9 box. */
  facade: number | null;
  /** Player height in px once tapped, or null for the 16:9 box. */
  player: number | null;
  /** The origin the iframe loads from. */
  origin: string;
}

/** One block per provider. The ids are 8-24 characters of letters, digits, _ and -. */
export const CASES: ProviderCase[] = [
  {
    name: "YouTube",
    provider: "youtube",
    id: "emb-youtube-01",
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    caption: "Behind the lens",
    label: "Play video: Behind the lens",
    below: "Behind the lens · YouTube",
    facade: null,
    player: null,
    origin: "https://www.youtube-nocookie.com",
  },
  {
    name: "Spotify",
    provider: "spotify",
    id: "emb-spotify-01",
    url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    caption: "A track",
    label: "",
    below: "A track · Spotify",
    facade: 152,
    player: 152,
    origin: "https://open.spotify.com",
  },
  {
    name: "Vimeo",
    provider: "vimeo",
    id: "emb-vimeo-0001",
    url: "https://vimeo.com/76979871",
    caption: "Studio reel",
    label: "Play video: Studio reel",
    below: "Studio reel · Vimeo",
    facade: null,
    player: null,
    origin: "https://player.vimeo.com",
  },
  {
    name: "TikTok",
    provider: "tiktok",
    id: "emb-tiktok-001",
    url: "https://www.tiktok.com/@mara/video/7234567890123456789",
    caption: "Quick clip",
    label: "Play video: Quick clip",
    below: "Quick clip · TikTok",
    facade: 120,
    player: 740,
    origin: "https://www.tiktok.com",
  },
  {
    name: "Instagram",
    provider: "instagram",
    id: "emb-instagram1",
    url: "https://www.instagram.com/reel/CxYz12AbCde/",
    caption: "Reel of the week",
    label: "Show post: Reel of the week",
    below: "Reel of the week · Instagram",
    facade: 120,
    player: 640,
    origin: "https://www.instagram.com",
  },
  {
    name: "SoundCloud",
    provider: "soundcloud",
    id: "emb-soundcloud1",
    url: "https://soundcloud.com/mara/night-market-mix",
    caption: "Night market mix",
    label: "Play music: Night market mix",
    below: "Night market mix · SoundCloud",
    facade: 166,
    player: 166,
    origin: "https://w.soundcloud.com",
  },
  {
    name: "Apple Music",
    provider: "applemusic",
    id: "emb-applemusic",
    url: "https://music.apple.com/us/album/the-album/1440857781",
    caption: "The album",
    label: "Play music: The album",
    below: "The album · Apple Music",
    facade: 450,
    player: 450,
    origin: "https://embed.music.apple.com",
  },
  {
    name: "Twitch",
    provider: "twitch",
    id: "emb-twitch-0001",
    url: "https://www.twitch.tv/mara_plays",
    caption: "Live now",
    label: "Watch stream: Live now",
    below: "Live now · Twitch",
    facade: null,
    player: null,
    origin: "https://player.twitch.tv",
  },
];

/** The six providers of M6-26. */
export const NEW_CASES = CASES.filter((c) => !["youtube", "spotify"].includes(c.provider));

export function embedBlock(c: Pick<ProviderCase, "id" | "url" | "caption">): Block {
  return { id: c.id, type: "embed", visible: true, url: c.url, caption: c.caption } as Block;
}

/** A page that is live with one embed of each provider (or of `cases`). */
export function liveEmbeds(
  label: string,
  cases: ProviderCase[] = CASES,
): Promise<PublishedTestPage> {
  return publishedPage(label, publishDocOf(cases.map(embedBlock)));
}

/** Every third-party host the embeds and the privacy check can name. */
export const THIRD_PARTY_HOSTS =
  /(^|\.)(vimeo\.com|vimeocdn\.com|tiktok\.com|tiktokcdn\.com|instagram\.com|facebook\.com|fbcdn\.net|soundcloud\.com|sndcdn\.com|apple\.com|mzstatic\.com|twitch\.tv|youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|spotify\.com|scdn\.co|evil\.example)$/;

/**
 * Answers every request to a third-party host with an empty page, so a tap mounts an iframe that
 * loads at once and nothing leaves the machine. A request the Content Security Policy blocks never
 * gets here: the browser refuses it first.
 */
export async function stubThirdParties(context: BrowserContext): Promise<string[]> {
  const seen: string[] = [];
  await context.route(
    (url) => THIRD_PARTY_HOSTS.test(url.hostname),
    async (route) => {
      seen.push(new URL(route.request().url()).hostname);
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>stub</title><p>stub</p>",
      });
    },
  );
  return seen;
}

/** Records every Content Security Policy violation the page reports, and every console message about one. */
export async function watchCsp(
  page: Page,
): Promise<{ violations: () => Promise<string[]>; messages: string[] }> {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to (frame|load)/i.test(message.text())) {
      messages.push(message.text());
    }
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return {
    messages,
    violations: () => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []),
  };
}

export const embedOf = (page: Page, id: string): Locator =>
  page.locator(`.pg-embed[data-block-id="${id}"]`);

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

/** Waits for the tapped iframe of an embed and returns its src. */
export async function tapAndGetSrc(page: Page, id: string): Promise<string> {
  const embed = embedOf(page, id);
  await embed.locator("button.pg-embed-play").click();
  const frame = embed.locator("iframe");
  await expect(frame).toHaveCount(1);
  return (await frame.getAttribute("src"))!;
}

export const publishButton = (page: Page): Locator =>
  page.getByRole("button", { name: /^Publish/ });
export const alertFor = (page: Page, text: string | RegExp): Locator =>
  page.getByRole("alert").filter({ hasText: text });
