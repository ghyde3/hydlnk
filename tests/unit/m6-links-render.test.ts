// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LINK_FEATURED, LINK_ICONS, LINK_ICON_LABELS, type PublishDoc } from "@/lib/document";
import { PageRenderer } from "@/components/page/page-renderer";
import { OWNER_UID, noirTokens } from "./fixtures/page-document";

/**
 * M6-20 and M6-22 on the renderer: the link's decorative first child, the escaping of a label next
 * to an icon, the `data-featured` lookup, the identical markup in the editor preview and on the
 * live page, and what the stylesheet is allowed to animate.
 */

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const THUMB = `${OWNER_UID}/avatar-0123456789ab.webp`;

const link = (extra: Record<string, unknown> = {}, id = "link-aaaa-0001") => ({
  id,
  type: "link",
  visible: true,
  label: "Book a session",
  url: "https://example.com/book",
  ...extra,
});

function render(
  blocks: unknown[],
  mode: "live" | "preview" = "live",
  extra: { thumbnail?: boolean } = {},
): string {
  const doc = {
    version: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: noirTokens,
    blocks,
  } as unknown as PublishDoc;
  return renderToStaticMarkup(
    createElement(PageRenderer, { doc, pageId: PAGE_ID, mode, ...extra }),
  );
}

const dom = (html: string): Document =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
const anchor = (html: string): HTMLElement => dom(html).querySelector(".pg-link")!;
const squash = (html: string) => html.replace(/\s+/g, " ");

/** The eight brand entries of the icon list: real brand marks, filled (M9-04). */
const BRAND_ICON_NAMES: readonly string[] = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "threads",
];

describe("M6-20 a link without an icon", () => {
  it("is the bare label in the anchor, with none of the new attributes", () => {
    const a = anchor(render([link()]));
    expect(a.innerHTML).toBe("Book a session");
    expect(a.hasAttribute("data-icon")).toBe(false);
    expect(a.hasAttribute("data-featured")).toBe(false);
    expect(a.getAttribute("href")).toBe(`/r/${PAGE_ID}/link-aaaa-0001`);
    expect(a.getAttribute("rel")).toBe("nofollow noopener");
  });
});

describe("M6-20 the built-in icon", () => {
  it.each(LINK_ICONS)("%s is the first child: a decorative inline SVG, then the label", (name) => {
    const a = anchor(render([link({ icon: { type: "builtin", name } })]));
    const first = a.firstElementChild!;
    expect(first.tagName.toLowerCase()).toBe("svg");
    expect(first.getAttribute("class")).toBe("pg-link-icon");
    expect(first.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(first.getAttribute("width")).toBe("20");
    expect(first.getAttribute("height")).toBe("20");
    expect(first.getAttribute("aria-hidden")).toBe("true");
    expect(first.getAttribute("focusable")).toBe("false");
    // The eight brand icons are filled marks (M9-04); the sixteen generic ones keep their line style.
    const brand = BRAND_ICON_NAMES.includes(name);
    expect(first.getAttribute("fill")).toBe(brand ? "currentColor" : "none");
    expect(first.getAttribute("stroke")).toBe(brand ? "none" : "currentColor");
    expect(first.hasAttribute("stroke-width")).toBe(!brand);
    expect(first.querySelectorAll("path, rect, circle").length).toBeGreaterThan(0);
    // Nothing remote: no <image>, <use>, href or xlink in the glyph.
    expect(first.innerHTML).not.toMatch(/<image|<use|href=|xlink|http/i);
    expect(a.children).toHaveLength(2);
    expect(a.children[1]!.className).toBe("pg-link-label");
    expect(a.getAttribute("data-icon")).toBe("builtin");
    // The accessible name is exactly the label: the glyph adds no text.
    expect(a.textContent).toBe("Book a session");
  });

  it("every icon draws a different shape", () => {
    const shapes = LINK_ICONS.map(
      (name) =>
        anchor(render([link({ icon: { type: "builtin", name } })])).firstElementChild!.innerHTML,
    );
    expect(new Set(shapes).size).toBe(24);
  });

  it("the eight brand glyphs, Email and Website are the social row's shapes", () => {
    const social = (platform: string, extra: object) =>
      dom(
        render([
          {
            id: "social-row-01",
            type: "social",
            visible: true,
            icons: [{ id: "icon-0001", platform, ...extra }],
          },
        ]),
      ).querySelector(".pg-social-glyph")!.innerHTML;
    const pairs: [string, string, object][] = [
      ["instagram", "instagram", { url: "https://instagram.com/x" }],
      ["tiktok", "tiktok", { url: "https://tiktok.com/x" }],
      ["youtube", "youtube", { url: "https://youtube.com/x" }],
      ["x", "x", { url: "https://x.com/x" }],
      ["facebook", "facebook", { url: "https://facebook.com/x" }],
      ["linkedin", "linkedin", { url: "https://linkedin.com/x" }],
      ["github", "github", { url: "https://github.com/x" }],
      ["threads", "threads", { url: "https://threads.net/x" }],
      ["mail", "email", { address: "a@example.com" }],
      ["globe", "website", { url: "https://example.com" }],
    ];
    for (const [icon, platform, extra] of pairs) {
      const glyph = anchor(
        render([link({ icon: { type: "builtin", name: icon } })]),
      ).firstElementChild!;
      expect(glyph.innerHTML, icon).toBe(social(platform, extra));
    }
  });

  it("a name that is not on the list draws no icon (a document stored by hand)", () => {
    for (const name of ["Instagram", "<script>", "__proto__", 'x"onload="alert(1)']) {
      const html = render([link({ icon: { type: "builtin", name } })]);
      const a = anchor(html);
      expect(a.innerHTML, name).toBe("Book a session");
      expect(a.hasAttribute("data-icon")).toBe(false);
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("onload=");
    }
  });
});

describe("M6-20 the thumbnail", () => {
  const image = { path: THUMB, width: 400, height: 400 };

  it("is a 40px lazy <img> from mediaUrl(path), the first child, with an empty alt", () => {
    const a = anchor(render([link({ icon: { type: "image", image } })]));
    const img = a.firstElementChild!;
    expect(img.tagName.toLowerCase()).toBe("img");
    expect(img.getAttribute("class")).toBe("pg-link-thumb");
    expect(img.getAttribute("src")).toBe(`https://media.test/page-media/${THUMB}`);
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("width")).toBe("40");
    expect(img.getAttribute("height")).toBe("40");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(a.getAttribute("data-icon")).toBe("image");
    expect(a.children[1]!.className).toBe("pg-link-label");
    expect(a.textContent).toBe("Book a session");
  });

  it("draws nothing for a path that is not a stored upload", () => {
    for (const path of [
      "https://evil.example/a.png",
      `${OWNER_UID}/../x/avatar-0123456789ab.webp`,
      "avatar.webp",
    ]) {
      const html = render([link({ icon: { type: "image", image: { ...image, path } } })]);
      expect(anchor(html).innerHTML, path).toBe("Book a session");
      expect(html).not.toContain("evil.example");
    }
  });

  it("the page never requests anything but its own media for an icon", () => {
    const html = render([
      link({ icon: { type: "image", image } }, "link-aaaa-0001"),
      link({ icon: { type: "builtin", name: "instagram" } }, "link-aaaa-0002"),
    ]);
    const urls = [...html.matchAll(/\b(?:src|href|srcset)="([^"]+)"/g)].map((m) => m[1]!);
    for (const value of urls) {
      expect(
        value.startsWith("/r/") || value.startsWith("https://media.test/page-media/"),
        value,
      ).toBe(true);
    }
  });
});

describe("M6-20 escaping next to an icon", () => {
  const label = "<img src=x onerror=alert(1)>";

  it.each([
    ["a built-in icon", { type: "builtin", name: "star" }],
    ["a thumbnail", { type: "image", image: { path: THUMB, width: 400, height: 400 } }],
  ])("a label of markup stays text beside %s", (_name, icon) => {
    const html = render([link({ label, icon })]);
    const a = anchor(html);
    expect(a.textContent).toBe(label);
    expect(a.querySelectorAll("img[onerror], img[src='x']")).toHaveLength(0);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toMatch(/<img[^>]*onerror/);
  });
});

describe("M6-22 the featured attribute", () => {
  it.each(LINK_FEATURED)("%s is set from the lookup", (featured) => {
    expect(anchor(render([link({ featured })])).getAttribute("data-featured")).toBe(featured);
  });

  it.each(["blink", "BOLD", '"><script>alert(1)</script>', "__proto__", "", "true"])(
    "a stored value of %j renders no attribute",
    (featured) => {
      const html = render([link({ featured })]);
      expect(anchor(html).hasAttribute("data-featured")).toBe(false);
      expect(html).not.toContain("alert(1)");
    },
  );

  it("is a block field: it never reaches the block's inline style", () => {
    const a = anchor(render([link({ featured: "pulse", overrides: { accent: "#C46A4F" } })]));
    expect(a.getAttribute("style")).toBe("--t-accent:#C46A4F");
    expect(a.getAttribute("data-featured")).toBe("pulse");
  });

  it("changes nothing else about the link: the href is still /r/<pageId>/<blockId>", () => {
    const plain = anchor(render([link()]));
    const featured = anchor(render([link({ featured: "shine" })]));
    expect(featured.getAttribute("href")).toBe(plain.getAttribute("href"));
    expect(featured.getAttribute("rel")).toBe(plain.getAttribute("rel"));
    expect(featured.textContent).toBe(plain.textContent);
    expect(featured.getAttribute("class")).toBe(plain.getAttribute("class"));
  });
});

describe("M6-20 and M6-22 parity of the editor preview and the live page", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["a built-in icon", { icon: { type: "builtin", name: "calendar" } }],
    ["a thumbnail", { icon: { type: "image", image: { path: THUMB, width: 400, height: 400 } } }],
    ["a bold link", { featured: "bold" }],
    ["a pulse link with an icon", { featured: "pulse", icon: { type: "builtin", name: "heart" } }],
    [
      "a shine link with a thumbnail",
      {
        featured: "shine",
        icon: { type: "image", image: { path: THUMB, width: 400, height: 400 } },
      },
    ],
    [
      "a long label with an icon",
      { label: "L".repeat(80), icon: { type: "builtin", name: "gift" } },
    ],
  ];

  it.each(cases)("%s: the markup is identical in both modes", (_name, extra) => {
    const blocks = [link(extra)];
    expect(squash(render(blocks, "preview"))).toBe(squash(render(blocks, "live")));
  });

  it("the dock's small copy keeps the look: a box with the same classes and attributes, no href", () => {
    const html = render(
      [link({ featured: "pulse", icon: { type: "builtin", name: "star" } })],
      "preview",
      { thumbnail: true },
    );
    const box = anchor(html);
    expect(box.tagName.toLowerCase()).toBe("div");
    expect(box.getAttribute("data-featured")).toBe("pulse");
    expect(box.getAttribute("data-icon")).toBe("builtin");
    expect(box.hasAttribute("href")).toBe(false);
    expect(box.firstElementChild!.tagName.toLowerCase()).toBe("svg");
  });
});

describe("M6-22 what the stylesheet may animate", () => {
  const ROOT = resolve(process.cwd());
  const css = readFileSync(join(ROOT, "src/components/page/page-renderer.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  /** The text of every `@media (prefers-reduced-motion: ...) { ... }` block, and the css without them. */
  function splitMotion(source: string): { inside: string[]; outside: string } {
    const inside: string[] = [];
    let outside = "";
    let from = 0;
    for (const match of source.matchAll(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*[\w-]+\s*\)\s*\{/g,
    )) {
      const start = match.index!;
      if (start < from) continue;
      let depth = 1;
      let i = start + match[0].length;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") depth -= 1;
        i += 1;
      }
      outside += source.slice(from, start);
      inside.push(match[0] + source.slice(start + match[0].length, i));
      from = i;
    }
    return { inside, outside: outside + source.slice(from) };
  }

  const { inside, outside } = splitMotion(css);

  it("every animation and every @keyframes sits inside prefers-reduced-motion: no-preference", () => {
    expect(inside.length).toBeGreaterThan(0);
    for (const block of inside) expect(block).toMatch(/prefers-reduced-motion\s*:\s*no-preference/);
    expect(outside).not.toMatch(/\banimation(?:-name)?\s*:/);
    expect(outside).not.toMatch(/@keyframes/);
    const motion = inside.join("\n");
    expect(motion).toMatch(/animation:\s*pg-featured-pulse 2\.4s ease-in-out infinite/);
    expect(motion).toMatch(/animation:\s*pg-featured-shine 4s/);
  });

  it("draws the motion from the accent and color-mix of tokens, with no color literal", () => {
    const motion = inside.join("\n");
    expect(motion).toMatch(/var\(--t-accent\)/);
    expect(motion).toMatch(/color-mix\(/);
    expect(motion).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|--hl-/i);
    for (const ref of motion.matchAll(/var\(\s*(--[\w-]+)/g)) expect(ref[1]).toMatch(/^--t-/);
  });

  it("the shine's highlight is a generated ::after that only exists with motion allowed", () => {
    expect(outside).not.toMatch(/data-featured="shine"\]::after/);
    expect(inside.join("\n")).toMatch(/\.pg-link\[data-featured="shine"\]::after/);
  });

  it("the bold style is static: weight 700, 8px more minimum height per density, a 2px accent ring", () => {
    expect(outside).toMatch(
      /\.pg-link\[data-featured\]\s*\{[^}]*min-height:\s*66px[^}]*font-weight:\s*700[^}]*box-shadow:\s*0 0 0 2px var\(--t-accent\)/,
    );
    expect(outside).toMatch(
      /data-density="compact"\]\s*\.pg-link\[data-featured\]\s*\{[^}]*min-height:\s*56px/,
    );
    expect(outside).toMatch(
      /data-density="airy"\]\s*\.pg-link\[data-featured\]\s*\{[^}]*min-height:\s*72px/,
    );
    // The shadow style keeps its offset next to the ring.
    expect(outside).toMatch(
      /\.pg-link\[data-featured\]\[data-button-style="shadow"\]\s*\{[^}]*0 0 0 2px var\(--t-accent\),\s*4px 4px 0/,
    );
  });

  it("no JavaScript drives the motion: the renderer has no timers, rAF or Web Animations", () => {
    const dir = join(ROOT, "src/components/page");
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(
        /requestAnimationFrame|setInterval|\.animate\(|IntersectionObserver/,
      );
    }
  });

  it("the link icon CSS keeps the label centered in the space left and wrapping", () => {
    expect(css).toMatch(/\.pg-link\[data-icon\]\s*\{[^}]*justify-content:\s*flex-start/);
    expect(css).toMatch(
      /\.pg-link-label\s*\{[^}]*flex:\s*1 1 0%[^}]*min-width:\s*0[^}]*text-align:\s*center/,
    );
    expect(css).toMatch(
      /\.pg-link-thumb\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*object-fit:\s*cover/,
    );
    expect(css).toMatch(/border-radius:\s*min\(var\(--t-radius\),\s*12px\)/);
  });
});

describe("the icon labels are the editor's button names", () => {
  it("has a label for each of the 24", () => {
    expect(LINK_ICONS.map((name) => LINK_ICON_LABELS[name]).every(Boolean)).toBe(true);
  });
});
