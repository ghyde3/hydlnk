// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { backgroundImagePath, backgroundImageUrl } from "@/components/page/background";
import { PageRenderer } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import type { TokenSet } from "@/lib/theme";
import { OWNER_UID, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M3-14, M3-15, M3-16: what the renderer draws for the three background types, and the rule that
 * an image can only ever be one of the owner's page-media objects (a hostile draft or theme row
 * written straight to the database must not make a public page load an image from another host).
 */

const BASE = "http://127.0.0.1:54321/storage/v1/object/public/page-media";
const FILE = "0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.jpg";
const OWN = `${BASE}/${OWNER_UID}/${FILE}`;
const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

function render(patch: Partial<TokenSet>): Document {
  const doc: PublishDoc = {
    version: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: { ...noirTokens, ...patch },
    blocks: [],
  };
  const html = renderToStaticMarkup(
    createElement(PageRenderer, { doc, pageId: PAGE_ID, mode: "live" }),
  );
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

const root = (dom: Document) => dom.querySelector("[data-page-root]") as HTMLElement;

describe("M3-15 backgroundImagePath: only this deployment's page-media objects", () => {
  it("returns {uid}/{file} for the bucket's public URL", () => {
    expect(backgroundImagePath(OWN)).toBe(`${OWNER_UID}/${FILE}`);
    expect(backgroundImagePath(`${BASE}/${OWNER_UID}/${FILE.replace("jpg", "webp")}`)).toMatch(
      /\.webp$/,
    );
  });

  it.each([
    ["null", null],
    ["empty", ""],
    [
      "a third-party host",
      `https://evil.example/storage/v1/object/public/page-media/${OWNER_UID}/${FILE}`,
    ],
    [
      "a lookalike host",
      `http://127.0.0.1:54321.evil.example/storage/v1/object/public/page-media/${OWNER_UID}/${FILE}`,
    ],
    [
      "credentials in the URL",
      `http://user:pw@127.0.0.1:54321/storage/v1/object/public/page-media/${OWNER_UID}/${FILE}`,
    ],
    [
      "another bucket",
      `http://127.0.0.1:54321/storage/v1/object/public/other/${OWNER_UID}/${FILE}`,
    ],
    [
      "a private-object path",
      `http://127.0.0.1:54321/storage/v1/object/authenticated/page-media/${OWNER_UID}/${FILE}`,
    ],
    ["a query string", `${OWN}?download=1`],
    ["a fragment", `${OWN}#x`],
    ["a trailing slash", `${OWN}/`],
    ["path traversal", `${BASE}/${OWNER_UID}/../${FILE}`],
    ["an encoded traversal", `${BASE}/${OWNER_UID}/%2e%2e/${FILE}`],
    ["a file name that is not an image reference", `${BASE}/${OWNER_UID}/evil.svg`],
    ["a path without the owner folder", `${BASE}/${FILE}`],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a javascript: URL", "javascript:alert(1)"],
    [
      "a protocol-relative URL",
      `//127.0.0.1:54321/storage/v1/object/public/page-media/${OWNER_UID}/${FILE}`,
    ],
    ["a CSS breakout", `${OWN}");}</style><script>alert(1)</script>`],
  ])("refuses %s", (_name, value) => {
    expect(backgroundImagePath(value as string | null)).toBeNull();
  });
});

describe("M3-15 backgroundImageUrl: only for the image type, rebuilt from the path", () => {
  it("is the page-media URL when the type is image and the image is the owner's", () => {
    expect(backgroundImageUrl({ bgType: "image", bgImage: OWN })).toBe(OWN);
  });

  it("is null for solid and gradient, even when an image is still stored", () => {
    expect(backgroundImageUrl({ bgType: "solid", bgImage: OWN })).toBeNull();
    expect(backgroundImageUrl({ bgType: "gradient", bgImage: OWN })).toBeNull();
  });

  it("is null for an image type without a usable image", () => {
    expect(backgroundImageUrl({ bgType: "image", bgImage: null })).toBeNull();
    expect(
      backgroundImageUrl({ bgType: "image", bgImage: "https://images.example.com/bg.webp" }),
    ).toBeNull();
  });
});

describe("M3-14 the root says which background it draws", () => {
  it("solid: data-bg-type solid and no image layer", () => {
    const dom = render({ bgType: "solid" });
    expect(root(dom).getAttribute("data-bg-type")).toBe("solid");
    expect(dom.querySelector("[data-bg-layer]")).toBeNull();
    expect(root(dom).style.getPropertyValue("--t-bg-image")).toBe("none");
  });

  it("gradient: data-bg-type gradient and no image layer", () => {
    const dom = render({ bgType: "gradient" });
    expect(root(dom).getAttribute("data-bg-type")).toBe("gradient");
    expect(dom.querySelector("[data-bg-layer]")).toBeNull();
  });

  it("an image type with no image falls back to solid", () => {
    const dom = render({ bgType: "image", bgImage: null });
    expect(root(dom).getAttribute("data-bg-type")).toBe("solid");
    expect(dom.querySelector("[data-bg-layer]")).toBeNull();
  });
});

describe("M3-15 / M3-16 the image layer", () => {
  it("draws an image layer and an overlay layer, behind the content, with the image URL variable", () => {
    const dom = render({ bgType: "image", bgImage: OWN, overlayOpacity: 0.6, blur: 12 });
    expect(root(dom).getAttribute("data-bg-type")).toBe("image");
    expect(root(dom).style.getPropertyValue("--t-bg-image")).toBe(`url("${OWN}")`);
    expect(root(dom).style.getPropertyValue("--t-overlay-opacity")).toBe("0.6");
    expect(root(dom).style.getPropertyValue("--t-blur")).toBe("12px");

    const layers = Array.from(dom.querySelectorAll("[data-bg-layer]")).map((el) =>
      el.getAttribute("data-bg-layer"),
    );
    expect(layers).toEqual(["image", "overlay"]);
    // The layers come first, so the column and everything in it paints over them, and they are
    // decorative: hidden from assistive technology.
    const first = root(dom).firstElementChild!;
    expect(first.className).toBe("pg-bg");
    expect(first.getAttribute("aria-hidden")).toBe("true");
    expect(first.nextElementSibling?.className).toBe("pg-column");
  });

  it("never loads an image from another host, whatever the token says", () => {
    for (const bgImage of [
      "https://images.example.com/bg.webp",
      `https://evil.example/storage/v1/object/public/page-media/${OWNER_UID}/${FILE}`,
      `${OWN}");}</style>`,
    ]) {
      const dom = render({ bgType: "image", bgImage });
      expect(root(dom).getAttribute("data-bg-type"), bgImage).toBe("solid");
      expect(root(dom).style.getPropertyValue("--t-bg-image"), bgImage).toBe("none");
      expect(dom.querySelector("[data-bg-layer]"), bgImage).toBeNull();
      expect(dom.body.innerHTML).not.toContain("evil.example");
      expect(dom.body.innerHTML).not.toContain("images.example.com");
    }
  });

  it("does not draw a stored image once the type is solid or gradient", () => {
    for (const bgType of ["solid", "gradient"] as const) {
      const dom = render({ bgType, bgImage: OWN });
      expect(dom.querySelector("[data-bg-layer]")).toBeNull();
      expect(root(dom).style.getPropertyValue("--t-bg-image")).toBe("none");
    }
  });
});

describe("M3-14 / M3-16 the stylesheet", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/components/page/page-renderer.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string): string => {
    const match = new RegExp(`${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `a rule for ${selector}`).not.toBeNull();
    return match![1]!;
  };

  it("gradient runs surface to bg, top to bottom, ending at 55%", () => {
    // M6-41: the direction and the two stops are the gradient tokens' variables. With none of them
    // set the serializer resolves them to 180deg, the surface color and the page color, so this is
    // still the M3-14 gradient (the stops are checked in tests/unit/m6-gradient-tokens.test.ts).
    expect(rule('[data-page-root][data-bg-type="gradient"]')).toMatch(
      /background:\s*linear-gradient\(\s*var\(--t-gradient-angle\),\s*var\(--t-gradient-from\)\s*0%,\s*var\(--t-gradient-to\)\s*55%\s*\)/,
    );
  });

  it("solid is the bg token on a root that is at least the viewport tall", () => {
    const base = rule("[data-page-root]");
    expect(base).toMatch(/background:\s*var\(--t-bg\)/);
    expect(base).toMatch(/min-height:\s*100dvh/);
  });

  it("blur is a filter on the image layer only, which is larger than the clip box", () => {
    const image = rule("[data-page-root] .pg-bg-image");
    expect(image).toMatch(/filter:\s*blur\(var\(--t-blur\)\)/);
    expect(image).toMatch(/inset:\s*calc\(var\(--t-blur\)\s*\*\s*-3\)/);
    expect(image).toMatch(/background-image:\s*var\(--t-bg-image\)/);
    expect(rule("[data-page-root] .pg-bg")).toMatch(/overflow:\s*hidden/);
    // No other rule blurs anything: text and buttons keep filter none.
    expect(css.match(/\bfilter\s*:/g)).toHaveLength(1);
    expect(css).not.toMatch(/backdrop-filter/);
  });

  it("the overlay is the bg token at the overlay opacity, above the image and below the column", () => {
    const overlay = rule("[data-page-root] .pg-bg-overlay");
    expect(overlay).toMatch(/background:\s*var\(--t-bg\)/);
    expect(overlay).toMatch(/opacity:\s*var\(--t-overlay-opacity\)/);
    expect(rule("[data-page-root] .pg-column")).toMatch(/z-index:\s*1/);
    expect(rule("[data-page-root] .pg-bg")).toMatch(/z-index:\s*0/);
  });
});
