// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbedFacade } from "@/components/page/embed-facade";
import { EmbedFacadeMarkup, facadePlayerSrc } from "@/components/page/embed-facade-markup";
import { parseEmbed } from "@/lib/document";

/**
 * M8-05 steps 3 to 5: the facade markup the server writes, the React `EmbedFacade` that draws the
 * same first paint in the editor preview, and the iframe each of them mounts. Table-driven over
 * every provider and kind of the allowlist, with the heights of EMBED_HEIGHTS (Spotify included).
 * The same comparison runs in real Chrome in tests/e2e/m8/assets-script.spec.ts.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = readFileSync(
  join(
    process.cwd(),
    "public/_t",
    readdirSync(join(process.cwd(), "public/_t")).find((name) =>
      /^p\.[0-9a-f]{12}\.js$/.test(name),
    )!,
  ),
  "utf8",
);

const SPOTIFY = "4uLU6hMCjMI75M1A2tKUQC";

interface Row {
  name: string;
  url: string;
  /** Pixels of the playing iframe, or null for the 16:9 players. */
  height: number | null;
  /** The autoplay flag the player URL carries, or null for none. */
  autoplay: [string, string] | null;
  fit: "video" | "player" | "bar";
  label: string;
  fullscreen: boolean;
}

const ROWS: Row[] = [
  {
    name: "YouTube",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    height: null,
    autoplay: ["autoplay", "1"],
    fit: "video",
    label: "Play video: Cap",
    fullscreen: true,
  },
  {
    name: "Vimeo",
    url: "https://vimeo.com/76979871",
    height: null,
    autoplay: ["autoplay", "1"],
    fit: "video",
    label: "Play video: Cap",
    fullscreen: true,
  },
  {
    name: "Twitch channel",
    url: "https://www.twitch.tv/mara_plays",
    height: null,
    autoplay: ["autoplay", "true"],
    fit: "video",
    label: "Watch stream: Cap",
    fullscreen: true,
  },
  {
    name: "Twitch video",
    url: "https://www.twitch.tv/videos/123456789",
    height: null,
    autoplay: ["autoplay", "true"],
    fit: "video",
    label: "Play video: Cap",
    fullscreen: true,
  },
  {
    name: "Twitch clip",
    url: "https://clips.twitch.tv/FamousHappyCaterpillar-AbCd",
    height: null,
    autoplay: ["autoplay", "true"],
    fit: "video",
    label: "Play video: Cap",
    fullscreen: true,
  },
  {
    name: "TikTok",
    url: "https://www.tiktok.com/@mara/video/7234567890123456789",
    height: 740,
    autoplay: null,
    fit: "bar",
    label: "Play video: Cap",
    fullscreen: false,
  },
  {
    name: "Instagram post",
    url: "https://www.instagram.com/p/CxYz12AbCde/",
    height: 560,
    autoplay: null,
    fit: "bar",
    label: "Show post: Cap",
    fullscreen: false,
  },
  {
    name: "Instagram reel",
    url: "https://www.instagram.com/reel/CxYz12AbCde/",
    height: 640,
    autoplay: null,
    fit: "bar",
    label: "Show post: Cap",
    fullscreen: false,
  },
  {
    name: "Instagram tv",
    url: "https://www.instagram.com/tv/CxYz12AbCde/",
    height: 640,
    autoplay: null,
    fit: "bar",
    label: "Show post: Cap",
    fullscreen: false,
  },
  {
    name: "SoundCloud track",
    url: "https://soundcloud.com/mara/night-market",
    height: 166,
    autoplay: ["auto_play", "true"],
    fit: "player",
    label: "Play music: Cap",
    fullscreen: false,
  },
  {
    name: "SoundCloud playlist",
    url: "https://soundcloud.com/mara/sets/field-recordings",
    height: 352,
    autoplay: ["auto_play", "true"],
    fit: "player",
    label: "Play music: Cap",
    fullscreen: false,
  },
  {
    name: "SoundCloud artist",
    url: "https://soundcloud.com/mara",
    height: 352,
    autoplay: ["auto_play", "true"],
    fit: "player",
    label: "Play music: Cap",
    fullscreen: false,
  },
  {
    name: "Apple Music song",
    url: "https://music.apple.com/us/album/the-album/1440857781?i=1440857790",
    height: 175,
    autoplay: null,
    fit: "player",
    label: "Play music: Cap",
    fullscreen: true,
  },
  {
    name: "Apple Music album",
    url: "https://music.apple.com/us/album/the-album/1440857781",
    height: 450,
    autoplay: null,
    fit: "player",
    label: "Play music: Cap",
    fullscreen: true,
  },
  {
    name: "Apple Music playlist",
    url: "https://music.apple.com/us/playlist/the-list/pl.f4d106fed2bd41149aaacabb233eb5eb",
    height: 450,
    autoplay: null,
    fit: "player",
    label: "Play music: Cap",
    fullscreen: true,
  },
  ...(["track", "episode"] as const).map((kind) => ({
    name: `Spotify ${kind}`,
    url: `https://open.spotify.com/${kind}/${SPOTIFY}`,
    height: 152,
    autoplay: null,
    fit: "player" as const,
    label: "Play music: Cap",
    fullscreen: false,
  })),
  ...(["album", "playlist", "show", "artist"] as const).map((kind) => ({
    name: `Spotify ${kind}`,
    url: `https://open.spotify.com/${kind}/${SPOTIFY}`,
    height: 352,
    autoplay: null,
    fit: "player" as const,
    label: "Play music: Cap",
    fullscreen: false,
  })),
];

const staticMarkup = (url: string, caption = "Cap") => {
  const embed = parseEmbed(url)!;
  return renderToStaticMarkup(
    createElement(EmbedFacadeMarkup, {
      provider: embed.provider,
      kind: embed.kind,
      src: embed.src,
      caption,
    }),
  );
};

describe("M8-05 the facade markup: one server-safe component with the data the script needs", () => {
  it.each(ROWS)("$name: classes, label, fit, height and data-embed-* attributes", (row) => {
    const html = staticMarkup(row.url);
    const doc = new JSDOM(`<body>${html}</body>`).window.document;
    const button = doc.querySelector("button")!;
    expect(doc.querySelectorAll("*").length).toBeGreaterThan(1);
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toBe("pg-embed-play");
    expect(button.getAttribute("aria-label")).toBe(row.label);
    expect(button.getAttribute("data-embed-fit")).toBe(row.fit);
    expect(button.hasAttribute("data-embed-fullscreen")).toBe(row.fullscreen);
    expect(button.getAttribute("data-embed-height")).toBe(
      row.height === null ? null : String(row.height),
    );
    const src = new URL(button.getAttribute("data-embed-src")!);
    expect(src.protocol).toBe("https:");
    expect(src.searchParams.has("parent")).toBe(false);
    if (row.autoplay) expect(src.searchParams.get(row.autoplay[0])).toBe(row.autoplay[1]);
    else expect(src.search).not.toMatch(/autoplay|auto_play/);
    expect(button.getAttribute("data-embed-title")).toMatch(/Cap/);
    expect(button.getAttribute("data-embed-allow")).not.toBe("");
    // No iframe, no URL anywhere but the one attribute.
    expect(doc.querySelector("iframe, img, script, a, [href], [srcset]")).toBeNull();
  });

  it("the Spotify facade reads like the others: label, title and allow list of the old iframe", () => {
    const html = staticMarkup(`https://open.spotify.com/track/${SPOTIFY}`, "Night market");
    const button = new JSDOM(`<body>${html}</body>`).window.document.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Play music: Night market");
    expect(button.getAttribute("data-embed-title")).toBe("Night market (Spotify player)");
    expect(button.getAttribute("data-embed-allow")).toBe(
      "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    );
    expect(button.getAttribute("data-embed-src")).toBe(
      `https://open.spotify.com/embed/track/${SPOTIFY}`,
    );
    expect(button.getAttribute("data-embed-fit")).toBe("player");
    const unnamed = new JSDOM(
      `<body>${staticMarkup(`https://open.spotify.com/track/${SPOTIFY}`, "")}</body>`,
    );
    const unnamedButton = unnamed.window.document.querySelector("button")!;
    expect(unnamedButton.getAttribute("aria-label")).toBe("Play music");
    expect(unnamedButton.getAttribute("data-embed-title")).toBe("Spotify player");
  });

  it("Twitch's data-embed-src is the parsed src plus &autoplay=true and never a parent", () => {
    for (const row of ROWS.filter((r) => r.name.startsWith("Twitch"))) {
      const embed = parseEmbed(row.url)!;
      expect(facadePlayerSrc(embed)).toBe(`${embed.src}&autoplay=true`);
      expect(staticMarkup(row.url)).not.toContain("parent");
    }
  });

  it("a hostile caption is escaped into the label and the title, never into markup", () => {
    const html = staticMarkup("https://vimeo.com/76979871", '"><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<img");
    const button = new JSDOM(`<body>${html}</body>`).window.document.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe('Play video: "><img src=x onerror=alert(1)>');
    expect(button.querySelectorAll("img")).toHaveLength(0);
  });
});

const mounted: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = [];

function mountReact(url: string, caption = "Cap") {
  const embed = parseEmbed(url)!;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(EmbedFacade, {
        provider: embed.provider,
        kind: embed.kind,
        src: embed.src,
        caption,
      }),
    ),
  );
  mounted.push({ root, host });
  return host;
}

afterEach(() => {
  while (mounted.length > 0) {
    const { root, host } = mounted.pop()!;
    act(() => root.unmount());
    host.remove();
  }
});

/** The script's side: the static markup in a page of its own, tapped, run by the real tenant script. */
function tapWithScript(url: string, caption = "Cap", pageUrl = "http://localhost:3000/") {
  const dom = new JSDOM(`<!DOCTYPE html><body>${staticMarkup(url, caption)}</body>`, {
    url: pageUrl,
    runScripts: "outside-only",
  });
  dom.window.eval(CODE);
  dom.window.document
    .querySelector("button")!
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  return dom.window.document;
}

describe("M8-05 the editor's React facade and the live script agree", () => {
  it.each(ROWS)("$name: the React facade's first paint is the static markup, byte for byte", (row) => {
    const embed = parseEmbed(row.url)!;
    const react = renderToStaticMarkup(
      createElement(EmbedFacade, {
        provider: embed.provider,
        kind: embed.kind,
        src: embed.src,
        caption: "Cap",
      }),
    );
    expect(react).toBe(staticMarkup(row.url));
    // The client render in the browser carries the same attributes (its style is CSSOM-serialized).
    const host = mountReact(row.url);
    const probe = document.createElement("div");
    probe.innerHTML = staticMarkup(row.url);
    expect(host.querySelector("button")!.getAttributeNames()).toEqual(
      probe.querySelector("button")!.getAttributeNames(),
    );
  });

  it.each(ROWS)(
    "$name: the iframe the script mounts is the iframe React mounts (outerHTML)",
    (row) => {
      const host = mountReact(row.url);
      act(() => host.querySelector("button")!.click());
      const react = host.querySelector("iframe")!;
      const script = tapWithScript(row.url).querySelector("iframe")!;
      expect(script.outerHTML).toBe(react.outerHTML);
      expect(script.outerHTML).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    },
  );

  it.each(ROWS)("$name: the iframe is as tall as EMBED_HEIGHTS says", (row) => {
    const frame = tapWithScript(row.url).querySelector("iframe")!;
    expect(frame.style.height).toBe(row.height === null ? "" : `${row.height}px`);
    expect(frame.hasAttribute("allowfullscreen")).toBe(row.fullscreen);
    if (row.autoplay) {
      expect(new URL(frame.getAttribute("src")!).searchParams.get(row.autoplay[0])).toBe(
        row.autoplay[1],
      );
    }
  });

  it("the Spotify iframe's title is '{caption} (Spotify player)' or 'Spotify player'", () => {
    const named = tapWithScript(`https://open.spotify.com/album/${SPOTIFY}`, "Night market");
    expect(named.querySelector("iframe")!.getAttribute("title")).toBe(
      "Night market (Spotify player)",
    );
    const plain = tapWithScript(`https://open.spotify.com/album/${SPOTIFY}`, "");
    expect(plain.querySelector("iframe")!.getAttribute("title")).toBe("Spotify player");
  });

  it("Twitch: both put parent={hostname} last, from window.location only", () => {
    const host = mountReact("https://www.twitch.tv/mara_plays");
    act(() => host.querySelector("button")!.click());
    const react = host.querySelector("iframe")!;
    const script = tapWithScript("https://www.twitch.tv/mara_plays").querySelector("iframe")!;
    expect(react.getAttribute("src")).toMatch(/&parent=localhost$/);
    expect(script.getAttribute("src")).toBe(react.getAttribute("src"));
  });
});

describe("M8-05 the shipped markup and script read no tenant URL", () => {
  /** The file without its comments, so a sentence about `block.url` is not a read of it. */
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("nothing that builds an iframe reads block.url (the M6-26 step 7 scan, now over the markup and the script)", () => {
    for (const path of [
      "src/components/page/embed-facade-markup.tsx",
      "src/components/page/embed-facade.tsx",
      "src/lib/tenant-assets/script/tenant.js",
    ]) {
      expect(read(path), path).not.toMatch(/block\.url|\.url\b/);
    }
  });

  it("the facade modules use no dangerouslySetInnerHTML and the React facade is the only client file", () => {
    expect(read("src/components/page/embed-facade-markup.tsx")).not.toMatch(
      /dangerouslySetInnerHTML|"use client"|useState|useEffect|useRef/,
    );
    expect(read("src/components/page/embed-facade.tsx")).toMatch(/^"use client";/);
  });
});
