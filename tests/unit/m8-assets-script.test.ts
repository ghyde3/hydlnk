import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { EmbedFacadeMarkup } from "@/components/page/embed-facade-markup";
import { parseEmbed } from "@/lib/document";

/**
 * M8-05, M8-06 (script side): the one vanilla tenant script, run in jsdom. Tap-to-play for every
 * provider from the data attributes the server writes, Twitch's `parent`, the origin allowlist, and
 * the view beacon's contract. The same script is compared with the React `EmbedFacade` in
 * m8-assets-facade.test.ts and with real Chrome in tests/e2e/m8/assets-script.spec.ts.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));

const PAGE_ID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
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

interface Env {
  dom: JSDOM;
  beacons: { url: string; body: string }[];
  errors: unknown[];
}

/** A page at `url` whose body is `body` (static HTML) with the script run the way a deferred tag runs it. */
function load(
  body: string,
  options: {
    url?: string;
    pageId?: string | null;
    referrer?: string;
    beacon?: "ok" | "missing" | "throws" | "false";
    state?: "loading" | "complete";
  } = {},
): Env {
  const { url = "http://mara.localhost:3000/", pageId = PAGE_ID, referrer = "" } = options;
  const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body>${body}</body></html>`, {
    url,
    ...(referrer === "" ? {} : { referrer }),
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const beacons: Env["beacons"] = [];
  const errors: unknown[] = [];
  dom.window.addEventListener("error", (event) => errors.push(event.error));
  const mode = options.beacon ?? "ok";
  const nav = dom.window.navigator as unknown as Record<string, unknown>;
  if (mode === "ok" || mode === "false") {
    nav.sendBeacon = (to: string, data: string) => {
      beacons.push({ url: to, body: data });
      return mode === "ok";
    };
  } else if (mode === "throws") {
    nav.sendBeacon = () => {
      throw new TypeError("blocked");
    };
  }
  if (options.state === "loading") {
    Object.defineProperty(dom.window.document, "readyState", {
      value: "loading",
      configurable: true,
    });
  }
  const script = dom.window.document.createElement("script");
  if (pageId !== null) script.setAttribute("data-page-id", pageId);
  script.textContent = CODE;
  dom.window.document.body.appendChild(script);
  return { dom, beacons, errors };
}

function facadeHtml(url: string, caption = "Cap"): string {
  const embed = parseEmbed(url)!;
  return `<div class="pg-embed" data-embed-provider="${embed.provider}">${renderToStaticMarkup(
    createElement(EmbedFacadeMarkup, {
      provider: embed.provider,
      kind: embed.kind,
      src: embed.src,
      caption,
    }),
  )}<p class="pg-embed-caption">x</p></div>`;
}

const click = (el: Element) =>
  el.dispatchEvent(new el.ownerDocument.defaultView!.MouseEvent("click", { bubbles: true }));

const ALL_PROVIDERS: { name: string; url: string; origin: string }[] = [
  {
    name: "YouTube",
    url: "https://youtu.be/dQw4w9WgXcQ",
    origin: "https://www.youtube-nocookie.com",
  },
  {
    name: "Spotify",
    url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    origin: "https://open.spotify.com",
  },
  { name: "Vimeo", url: "https://vimeo.com/76979871", origin: "https://player.vimeo.com" },
  {
    name: "TikTok",
    url: "https://www.tiktok.com/@mara/video/7234567890123456789",
    origin: "https://www.tiktok.com",
  },
  {
    name: "Instagram",
    url: "https://www.instagram.com/p/CxYz12AbCde/",
    origin: "https://www.instagram.com",
  },
  {
    name: "SoundCloud",
    url: "https://soundcloud.com/mara/night-market",
    origin: "https://w.soundcloud.com",
  },
  {
    name: "Apple Music",
    url: "https://music.apple.com/us/album/the-album/1440857781",
    origin: "https://embed.music.apple.com",
  },
  { name: "Twitch", url: "https://www.twitch.tv/mara_plays", origin: "https://player.twitch.tv" },
];

describe("M8-05 tap to play from data attributes", () => {
  it("loading the script requests nothing and mounts no iframe, for all eight providers", () => {
    const { dom, errors } = load(ALL_PROVIDERS.map((p) => facadeHtml(p.url)).join(""));
    expect(dom.window.document.querySelectorAll("iframe")).toHaveLength(0);
    expect(dom.window.document.querySelectorAll("button.pg-embed-play")).toHaveLength(8);
    expect(errors).toEqual([]);
  });

  it.each(ALL_PROVIDERS)(
    "$name: one tap swaps the button for one iframe on the provider's origin",
    (p) => {
      const { dom } = load(facadeHtml(p.url, "Night market"));
      const doc = dom.window.document;
      click(doc.querySelector("button.pg-embed-play")!);
      const frames = doc.querySelectorAll("iframe");
      expect(frames).toHaveLength(1);
      expect(doc.querySelector("button.pg-embed-play")).toBeNull();
      const frame = frames[0]!;
      expect(new URL(frame.getAttribute("src")!).origin).toBe(p.origin);
      expect(frame.className).toBe("pg-embed-iframe");
      expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
      expect(frame.getAttribute("title")).toMatch(/Night market/);
      expect(doc.activeElement).toBe(frame);
      // The caption under the player stays.
      expect(doc.querySelector(".pg-embed-caption")).not.toBeNull();
    },
  );

  it("a double click, a second click and a click elsewhere mount one iframe only", () => {
    const { dom } = load(
      facadeHtml("https://vimeo.com/76979871") + facadeHtml("https://vimeo.com/76979872"),
    );
    const doc = dom.window.document;
    const [first, second] = [...doc.querySelectorAll("button.pg-embed-play")];
    click(first!);
    click(first!);
    click(doc.querySelector("iframe")!);
    click(doc.body);
    expect(doc.querySelectorAll("iframe")).toHaveLength(1);
    // The other embed is still a poster.
    expect(doc.querySelectorAll("button.pg-embed-play")).toHaveLength(1);
    expect(doc.querySelector("button.pg-embed-play")).toBe(second);
  });

  it("a tap on the play glyph inside the button counts as a tap on the button", () => {
    const { dom } = load(facadeHtml("https://youtu.be/dQw4w9WgXcQ"));
    const doc = dom.window.document;
    click(doc.querySelector("button.pg-embed-play path")!);
    expect(doc.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("Twitch gets parent={hostname} appended on the tap, and nothing else does", () => {
    const twitch = load(facadeHtml("https://www.twitch.tv/mara_plays"), {
      url: "http://mara.localhost:3000/",
    });
    click(twitch.dom.window.document.querySelector("button.pg-embed-play")!);
    expect(twitch.dom.window.document.querySelector("iframe")!.getAttribute("src")).toBe(
      "https://player.twitch.tv/?channel=mara_plays&autoplay=true&parent=mara.localhost",
    );
    const custom = load(facadeHtml("https://clips.twitch.tv/FamousHappyCaterpillar-AbCd"), {
      url: "https://links.example.test/",
    });
    click(custom.dom.window.document.querySelector("button.pg-embed-play")!);
    expect(custom.dom.window.document.querySelector("iframe")!.getAttribute("src")).toBe(
      "https://clips.twitch.tv/embed?clip=FamousHappyCaterpillar-AbCd&autoplay=true&parent=links.example.test",
    );
    for (const p of ALL_PROVIDERS.filter((p) => p.name !== "Twitch")) {
      const env = load(facadeHtml(p.url), { url: "http://mara.localhost:3000/" });
      click(env.dom.window.document.querySelector("button.pg-embed-play")!);
      expect(env.dom.window.document.querySelector("iframe")!.getAttribute("src")).not.toContain(
        "parent=",
      );
    }
  });

  it("a hostname that is not plain letters, digits, dots and dashes mounts no Twitch iframe", () => {
    const env = load(facadeHtml("https://www.twitch.tv/mara_plays"), { url: "http://[::1]:3000/" });
    const doc = env.dom.window.document;
    click(doc.querySelector("button.pg-embed-play")!);
    expect(doc.querySelectorAll("iframe")).toHaveLength(0);
    const note = doc.querySelector("p.pg-embed-unavailable")!;
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toBe("This embed can’t load here.");
    expect(doc.querySelector("button.pg-embed-play")).toBeNull();
  });
});

describe("M8-05 a page holding the most embeds the document limit allows", () => {
  it("behaves the same: one listener, one tap, one iframe, whatever the count", async () => {
    const { LIMITS } = await import("@/lib/document");
    const html = Array.from({ length: LIMITS.blocks }, (_, i) =>
      facadeHtml(`https://vimeo.com/${76979871 + i}`, `Clip ${i}`),
    ).join("");
    const { dom, errors } = load(html);
    const doc = dom.window.document;
    expect(doc.querySelectorAll("button.pg-embed-play")).toHaveLength(LIMITS.blocks);
    click(doc.querySelectorAll("button.pg-embed-play")[LIMITS.blocks - 1]!);
    expect(doc.querySelectorAll("iframe")).toHaveLength(1);
    expect(doc.querySelectorAll("button.pg-embed-play")).toHaveLength(LIMITS.blocks - 1);
    expect(doc.querySelector("iframe")!.getAttribute("title")).toBe(
      `Clip ${LIMITS.blocks - 1} (Vimeo player)`,
    );
    expect(errors).toEqual([]);
    // The script's size has nothing to do with how many embeds there are.
    expect(gzipSync(CODE).length).toBeLessThan(3 * 1024);
  });
});

describe("M8-05 a tampered DOM mounts nothing", () => {
  const evil = (value: string) =>
    `<div class="pg-embed"><button type="button" class="pg-embed-play" data-embed-src="${value}" data-embed-allow="autoplay"></button></div>`;

  it.each([
    "https://evil.example/x",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://vimeo.com/76979871",
    "https://www.youtube-nocookie.com.evil.example/embed/x",
    "https://player.twitch.tv@evil.example/",
    "//evil.example/x",
    "not a url",
    "",
  ])("%j", (value) => {
    const { dom, errors } = load(evil(value));
    const doc = dom.window.document;
    click(doc.querySelector("button.pg-embed-play")!);
    expect(doc.querySelectorAll("iframe")).toHaveLength(0);
    expect(doc.querySelector("p.pg-embed-unavailable")?.textContent).toBe(
      "This embed can’t load here.",
    );
    expect(errors).toEqual([]);
  });

  it("a button with no data-embed-src is not an embed button: the tap does nothing", () => {
    const { dom } = load(`<button type="button" class="pg-embed-play" id="b"></button>`);
    click(dom.window.document.getElementById("b")!);
    expect(dom.window.document.querySelectorAll("iframe")).toHaveLength(0);
    expect(dom.window.document.getElementById("b")).not.toBeNull();
  });

  it("reads the allow list as the iframe's allow attribute and nothing else from the DOM", () => {
    const html = `<div class="pg-embed" data-embed-provider="evil"><button type="button" class="pg-embed-play"
      data-embed-src="https://www.tiktok.com/embed/v2/7234567890123456789" data-embed-title="T"
      data-embed-allow="camera; microphone" data-embed-height="9999999" data-embed-fullscreen="">
      </button></div>`;
    const { dom } = load(html);
    const doc = dom.window.document;
    click(doc.querySelector("button")!);
    const frame = doc.querySelector("iframe")!;
    expect(frame.getAttribute("allow")).toBe("camera; microphone");
    expect(frame.hasAttribute("allowfullscreen")).toBe(true);
    // An absurd height is ignored (the 16:9 box stays), never copied into a style.
    expect(frame.getAttribute("style")).toBeNull();
  });
});

describe("M8-06 the view beacon from the shared script", () => {
  it("after the load event: one sendBeacon('/api/e', {pageId, referrer}), exactly once", () => {
    const env = load("", { referrer: "https://news.example/story", state: "loading" });
    expect(env.beacons).toHaveLength(0);
    const win = env.dom.window;
    win.dispatchEvent(new win.Event("load"));
    win.dispatchEvent(new win.Event("load"));
    expect(env.beacons).toHaveLength(1);
    expect(env.beacons[0]!.url).toBe("/api/e");
    expect(JSON.parse(env.beacons[0]!.body)).toEqual({
      pageId: PAGE_ID,
      referrer: "https://news.example/story",
    });
    // Exactly the two keys, in the order the inline script of M4-21 wrote them.
    expect(Object.keys(JSON.parse(env.beacons[0]!.body))).toEqual(["pageId", "referrer"]);
    expect(env.beacons[0]!.body).toBe(
      `{"pageId":"${PAGE_ID}","referrer":"https://news.example/story"}`,
    );
  });

  it("at once when the document is already complete (readyState 'complete')", async () => {
    const dom = new JSDOM("<!DOCTYPE html><body></body>", {
      url: "http://mara.localhost:3000/",
      referrer: "https://a.example/",
      runScripts: "dangerously",
    });
    await new Promise((resolve) => dom.window.addEventListener("load", resolve));
    expect(dom.window.document.readyState).toBe("complete");
    const sent: { url: string; body: string }[] = [];
    (dom.window.navigator as unknown as Record<string, unknown>).sendBeacon = (
      url: string,
      body: string,
    ) => sent.push({ url, body }) > 0;
    const script = dom.window.document.createElement("script");
    script.setAttribute("data-page-id", PAGE_ID);
    script.textContent = CODE;
    dom.window.document.body.appendChild(script);
    expect(sent).toEqual([
      { url: "/api/e", body: `{"pageId":"${PAGE_ID}","referrer":"https://a.example/"}` },
    ]);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["tampered", '"><x'],
    ["a non-UUID", "not-a-uuid"],
    ["an uppercase-free almost UUID", "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e0"],
    ["a script injection", `${PAGE_ID}"></script><script>alert(1)</script>`],
  ])("a data-page-id that is %s sends nothing and throws nothing", (_name, pageId) => {
    const env = load("", { pageId, state: "loading" });
    const win = env.dom.window;
    win.dispatchEvent(new win.Event("load"));
    expect(env.beacons).toHaveLength(0);
    expect(env.errors).toEqual([]);
  });

  it("accepts an uppercase UUID as the old inline script's check did", () => {
    const env = load("", { pageId: PAGE_ID.toUpperCase(), state: "loading" });
    env.dom.window.dispatchEvent(new env.dom.window.Event("load"));
    expect(env.beacons).toHaveLength(1);
  });

  it.each(["missing", "throws", "false"] as const)(
    "a sendBeacon that is %s is swallowed and tap-to-play still works",
    (beacon) => {
      const env = load(facadeHtml("https://youtu.be/dQw4w9WgXcQ"), { beacon, state: "loading" });
      env.dom.window.dispatchEvent(new env.dom.window.Event("load"));
      click(env.dom.window.document.querySelector("button.pg-embed-play")!);
      expect(env.dom.window.document.querySelectorAll("iframe")).toHaveLength(1);
      expect(env.errors).toEqual([]);
    },
  );

  it("a tap never sends a second beacon", () => {
    const env = load(facadeHtml("https://youtu.be/dQw4w9WgXcQ"), { state: "loading" });
    env.dom.window.dispatchEvent(new env.dom.window.Event("load"));
    click(env.dom.window.document.querySelector("button.pg-embed-play")!);
    expect(env.beacons).toHaveLength(1);
  });

  it("runs on a page with no script element of its own (currentScript is null): no beacon, tap-to-play works", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><body>${facadeHtml("https://youtu.be/dQw4w9WgXcQ")}</body>`,
      {
        url: "http://mara.localhost:3000/",
        runScripts: "outside-only",
      },
    );
    const sent: string[] = [];
    (dom.window.navigator as unknown as Record<string, unknown>).sendBeacon = (
      _u: string,
      d: string,
    ) => sent.push(d);
    dom.window.eval(CODE);
    dom.window.dispatchEvent(new dom.window.Event("load"));
    expect(sent).toEqual([]);
    click(dom.window.document.querySelector("button.pg-embed-play")!);
    expect(dom.window.document.querySelectorAll("iframe")).toHaveLength(1);
  });
});
