// @vitest-environment jsdom
import "./fixtures/react-facade";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PageRenderer } from "@/components/page/page-renderer";
import type { Block, PublishDoc } from "@/lib/document";
import { blocks, fullPublished } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M6-27: the shared tap-to-play facade. One embed of each of the six new providers renders as a
 * button on a poster (no iframe, no third-party request), and a tap mounts an iframe whose src
 * comes from parseEmbed only.
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

interface Case {
  name: string;
  provider: string;
  url: string;
  caption: string;
  label: string;
  captionText: string;
  fit: "video" | "player" | "bar";
  height: number | null;
  tapped: { origin: string; path?: string; params?: Record<string, string>; height: number | null };
  allow: string;
  fullscreen: boolean;
}

const CASES: Case[] = [
  {
    name: "Vimeo",
    provider: "vimeo",
    url: "https://vimeo.com/76979871",
    caption: "Reel",
    label: "Play video: Reel",
    captionText: "Reel · Vimeo",
    fit: "video",
    height: null,
    tapped: {
      origin: "https://player.vimeo.com",
      path: "/video/76979871",
      params: { dnt: "1", autoplay: "1" },
      height: null,
    },
    allow: "autoplay; fullscreen; picture-in-picture; encrypted-media",
    fullscreen: true,
  },
  {
    name: "TikTok",
    provider: "tiktok",
    url: "https://www.tiktok.com/@mara/video/7234567890123456789",
    caption: "Clip",
    label: "Play video: Clip",
    captionText: "Clip · TikTok",
    fit: "bar",
    height: 120,
    tapped: {
      origin: "https://www.tiktok.com",
      path: "/embed/v2/7234567890123456789",
      height: 740,
    },
    allow: "encrypted-media",
    fullscreen: false,
  },
  {
    name: "Instagram post",
    provider: "instagram",
    url: "https://www.instagram.com/p/CxYz12AbCde/",
    caption: "Post",
    label: "Show post: Post",
    captionText: "Post · Instagram",
    fit: "bar",
    height: 120,
    tapped: { origin: "https://www.instagram.com", path: "/p/CxYz12AbCde/embed", height: 560 },
    allow: "encrypted-media",
    fullscreen: false,
  },
  {
    name: "Instagram reel",
    provider: "instagram",
    url: "https://www.instagram.com/reel/CxYz12AbCde/",
    caption: "Reel",
    label: "Show post: Reel",
    captionText: "Reel · Instagram",
    fit: "bar",
    height: 120,
    tapped: { origin: "https://www.instagram.com", path: "/reel/CxYz12AbCde/embed", height: 640 },
    allow: "encrypted-media",
    fullscreen: false,
  },
  {
    name: "SoundCloud track",
    provider: "soundcloud",
    url: "https://soundcloud.com/mara/night-market",
    caption: "Mix",
    label: "Play music: Mix",
    captionText: "Mix · SoundCloud",
    fit: "player",
    height: 166,
    tapped: {
      origin: "https://w.soundcloud.com",
      path: "/player/",
      params: { url: "https://soundcloud.com/mara/night-market", auto_play: "true" },
      height: 166,
    },
    allow: "autoplay",
    fullscreen: false,
  },
  {
    name: "SoundCloud playlist",
    provider: "soundcloud",
    url: "https://soundcloud.com/mara/sets/field-recordings",
    caption: "Set",
    label: "Play music: Set",
    captionText: "Set · SoundCloud",
    fit: "player",
    height: 352,
    tapped: {
      origin: "https://w.soundcloud.com",
      path: "/player/",
      params: { auto_play: "true" },
      height: 352,
    },
    allow: "autoplay",
    fullscreen: false,
  },
  {
    name: "Apple Music album",
    provider: "applemusic",
    url: "https://music.apple.com/us/album/the-album/1440857781",
    caption: "Album",
    label: "Play music: Album",
    captionText: "Album · Apple Music",
    fit: "player",
    height: 450,
    tapped: {
      origin: "https://embed.music.apple.com",
      path: "/us/album/the-album/1440857781",
      height: 450,
    },
    allow: "autoplay; encrypted-media; fullscreen; clipboard-write",
    fullscreen: true,
  },
  {
    name: "Apple Music song",
    provider: "applemusic",
    url: "https://music.apple.com/us/album/the-album/1440857781?i=1440857790",
    caption: "Song",
    label: "Play music: Song",
    captionText: "Song · Apple Music",
    fit: "player",
    height: 175,
    tapped: {
      origin: "https://embed.music.apple.com",
      path: "/us/song/the-album/1440857790",
      height: 175,
    },
    allow: "autoplay; encrypted-media; fullscreen; clipboard-write",
    fullscreen: true,
  },
  {
    name: "Twitch video",
    provider: "twitch",
    url: "https://www.twitch.tv/videos/123456789",
    caption: "VOD",
    label: "Play video: VOD",
    captionText: "VOD · Twitch",
    fit: "video",
    height: null,
    tapped: {
      origin: "https://player.twitch.tv",
      path: "/",
      params: { video: "v123456789", autoplay: "true", parent: "localhost" },
      height: null,
    },
    allow: "autoplay; fullscreen",
    fullscreen: true,
  },
  {
    name: "Twitch channel",
    provider: "twitch",
    url: "https://www.twitch.tv/mara_plays",
    caption: "Live",
    label: "Watch stream: Live",
    captionText: "Live · Twitch",
    fit: "video",
    height: null,
    tapped: {
      origin: "https://player.twitch.tv",
      path: "/",
      params: { channel: "mara_plays", autoplay: "true", parent: "localhost" },
      height: null,
    },
    allow: "autoplay; fullscreen",
    fullscreen: true,
  },
  {
    name: "Twitch clip",
    provider: "twitch",
    url: "https://clips.twitch.tv/FamousHappyCaterpillar-AbCd",
    caption: "Clip",
    label: "Play video: Clip",
    captionText: "Clip · Twitch",
    fit: "video",
    height: null,
    tapped: {
      origin: "https://clips.twitch.tv",
      path: "/embed",
      params: { clip: "FamousHappyCaterpillar-AbCd", autoplay: "true", parent: "localhost" },
      height: null,
    },
    allow: "autoplay; fullscreen",
    fullscreen: true,
  },
];

function embedBlock(c: Pick<Case, "url" | "caption">, id = "embed-test-0001"): Block {
  return { id, type: "embed", visible: true, url: c.url, caption: c.caption } as Block;
}

function docWith(...list: Block[]): PublishDoc {
  return { ...fullPublished, blocks: list };
}

const mounted: { unmount: () => void; host: HTMLElement }[] = [];

function mount(list: Block[], mode: "live" | "preview" = "live") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(PageRenderer, { doc: docWith(...list), pageId: PAGE_ID, mode }));
  });
  mounted.push({ host, unmount: () => act(() => root.unmount()) });
  return host;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.unmount();
    entry.host.remove();
  }
});

describe("M6-27 the facade of each new provider", () => {
  it.each(CASES)("$name: a button on a poster, no iframe, the caption below", (c) => {
    const host = mount([embedBlock(c)]);
    expect(host.querySelector("iframe")).toBeNull();
    const button = host.querySelector<HTMLButtonElement>("[data-block-type=embed] button")!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toBe("pg-embed-play");
    expect(button.getAttribute("aria-label")).toBe(c.label);
    expect(button.getAttribute("data-embed-fit")).toBe(c.fit);
    expect(button.style.height).toBe(c.height === null ? "" : `${c.height}px`);
    expect(host.querySelector("[data-block-type=embed]")?.getAttribute("data-embed-provider")).toBe(
      c.provider,
    );
    expect(host.querySelector(".pg-embed-caption")?.textContent).toBe(c.captionText);
  });

  it.each(CASES)("$name: nothing from the provider is in the markup before a tap", (c) => {
    const host = mount([embedBlock(c)]);
    const block = host.querySelector("[data-block-type=embed]")!;
    // The block has no URL at all (no src, no href, no srcset, no thumbnail) and no element that loads one.
    // (The one URL the markup carries is the player's own address in `data-embed-src`, which only the tap
    // upgrades into an iframe: M8-05.)
    expect(block.outerHTML.replace(/ data-embed-src="[^"]*"/, "")).not.toContain("://");
    expect(
      block.querySelector(
        "[src], [href], [srcset], [data-src], iframe, img, script, link, video, source, object, embed",
      ),
    ).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
  });

  it.each(CASES)(
    "$name: a tap mounts the iframe with the parsed src, title and allow list",
    (c) => {
      const host = mount([embedBlock(c)]);
      act(() => host.querySelector<HTMLButtonElement>("[data-block-type=embed] button")!.click());
      expect(host.querySelector("[data-block-type=embed] button")).toBeNull();
      const frame = host.querySelector("iframe")!;
      expect(frame).not.toBeNull();
      const src = new URL(frame.getAttribute("src")!);
      expect(src.origin).toBe(c.tapped.origin);
      if (c.tapped.path !== undefined) expect(src.pathname).toBe(c.tapped.path);
      for (const [key, value] of Object.entries(c.tapped.params ?? {})) {
        expect(src.searchParams.get(key), key).toBe(value);
      }
      expect(frame.getAttribute("title")).toBe(
        `${c.caption} (${c.captionText.split(" · ")[1]} player)`,
      );
      expect(frame.getAttribute("allow")).toBe(c.allow);
      expect(frame.hasAttribute("allowfullscreen")).toBe(c.fullscreen);
      expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
      expect(frame.style.height).toBe(c.tapped.height === null ? "" : `${c.tapped.height}px`);
      expect(document.activeElement).toBe(frame);
      // The caption stays under the player.
      expect(host.querySelector(".pg-embed-caption")?.textContent).toBe(c.captionText);
    },
  );

  it("titles an unnamed player '{Provider} player' and labels an unnamed button without a colon", () => {
    const host = mount([embedBlock({ url: "https://vimeo.com/76979871", caption: "" })]);
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(button.getAttribute("aria-label")).toBe("Play video");
    expect(host.querySelector(".pg-embed-caption")?.textContent).toBe("Vimeo");
    act(() => button.click());
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("Vimeo player");
  });

  it("YouTube is the same facade and keeps its older wording", () => {
    const host = mount([blocks.embed as Block]);
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(button.getAttribute("aria-label")).toBe("Play video: Behind the lens, ep. 4");
    expect(button.getAttribute("data-embed-fit")).toBe("video");
    act(() => button.click());
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?autoplay=1",
    );
    expect(frame.getAttribute("title")).toBe("Behind the lens, ep. 4 (YouTube video)");
  });

  it("Spotify is a facade like the rest (M8-05): a poster as tall as its player, and a tap mounts the same iframe the old one was", () => {
    const host = mount([
      embedBlock({ url: "https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M", caption: "Song" }),
    ]);
    expect(host.querySelector("iframe")).toBeNull();
    const button = host.querySelector<HTMLButtonElement>("[data-block-type=embed] button")!;
    expect(button.getAttribute("aria-label")).toBe("Play music: Song");
    expect(button.getAttribute("data-embed-fit")).toBe("player");
    expect(button.style.height).toBe("152px");
    expect(host.querySelector(".pg-embed-caption")?.textContent).toBe("Song · Spotify");
    act(() => button.click());
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(
      "https://open.spotify.com/embed/track/37i9dQZF1DXcBWIGoYBM5M",
    );
    expect(frame.getAttribute("title")).toBe("Song (Spotify player)");
    expect(frame.style.height).toBe("152px");
  });

  it("a stored embed that parses to nothing renders no iframe on the live page", () => {
    for (const url of [
      "https://vimeo.com.evil.example/123456",
      "https://evil.example/x",
      'https://www.tiktok.com/@mara/video/1"onload="alert(1)',
      "javascript:alert(1)",
      "https://vm.tiktok.com/ZMabc123/",
    ]) {
      const html = renderToStaticMarkup(
        createElement(PageRenderer, {
          doc: docWith(embedBlock({ url, caption: "x" })),
          pageId: PAGE_ID,
          mode: "live",
        }),
      );
      expect(html, url).not.toContain("iframe");
      expect(html, url).not.toContain('data-block-type="embed"');
    }
  });

  it("the preview and the live page render identical markup for every provider", () => {
    for (const c of CASES) {
      const render = (mode: "live" | "preview") =>
        renderToStaticMarkup(
          createElement(PageRenderer, { doc: docWith(embedBlock(c)), pageId: PAGE_ID, mode }),
        );
      expect(render("preview"), c.name).toBe(render("live"));
    }
  });

  it("switching the address to another provider replaces the facade at once, even after a tap", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const show = (c: Pick<Case, "url" | "caption">) =>
      act(() => {
        root.render(
          createElement(PageRenderer, {
            doc: docWith(embedBlock(c)),
            pageId: PAGE_ID,
            mode: "preview",
          }),
        );
      });
    show({ url: "https://vimeo.com/76979871", caption: "A" });
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector("iframe")).not.toBeNull();
    show({ url: "https://soundcloud.com/mara/night-market", caption: "A" });
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Play music: A");
    expect(host.querySelector("[data-block-type=embed]")?.getAttribute("data-embed-provider")).toBe(
      "soundcloud",
    );
    act(() => root.unmount());
    host.remove();
  });

  it("the dock thumbnail and the shared preview draw a still poster, never a button or an iframe", () => {
    for (const c of CASES) {
      for (const flag of [{ thumbnail: true }, { inertEmbeds: true }]) {
        const html = renderToStaticMarkup(
          createElement(PageRenderer, {
            doc: docWith(embedBlock(c)),
            pageId: PAGE_ID,
            mode: "preview",
            ...flag,
          }),
        );
        expect(html, c.name).toContain("pg-embed-play");
        expect(html, c.name).not.toMatch(/<button|<iframe/);
      }
    }
  });
});

describe("M6-27 static scan: an iframe src is built from the parsed embed only", () => {
  const dir = join(process.cwd(), "src/components/page");
  const sources = readdirSync(dir)
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => [file, readFileSync(join(dir, file), "utf8")] as const);

  it("no renderer file reads block.url or any .url for an iframe src", () => {
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/src=\{block\.url|src=\{[a-z]*\.url\b|<iframe[^>]*block\.url/);
    }
  });

  it("the facade's iframe src is embedPlayerSrc of the parsed src; Spotify's is embed.src", () => {
    const facade = readFileSync(join(dir, "embed-facade.tsx"), "utf8");
    expect(facade).toMatch(/src=\{playerSrc\}/);
    expect(facade).toMatch(/embedPlayerSrc\(\{ provider, src \}/);
    const blocksFile = readFileSync(join(dir, "blocks.tsx"), "utf8");
    expect(blocksFile).toMatch(/src=\{embed\.src\}/);
    expect(blocksFile).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("the Twitch parent is read only from window.location.hostname, after a tap", () => {
    const facade = readFileSync(join(dir, "embed-facade.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(facade.match(/window\.location/g)).toHaveLength(1);
    expect(facade).toMatch(/window\.location\.hostname/);
    expect(facade).not.toMatch(/location\.(search|href|hash|pathname)/);
    // It sits inside the `playing` branch, never in the first render.
    const playing = facade.indexOf("if (playing) {");
    const hostname = facade.indexOf("window.location.hostname");
    const poster = facade.lastIndexOf("<EmbedFacadeMarkup");
    expect(playing).toBeGreaterThan(0);
    expect(hostname).toBeGreaterThan(playing);
    expect(hostname).toBeLessThan(poster);
  });

  it("no renderer file sets raw HTML", () => {
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=/);
    }
  });
});
