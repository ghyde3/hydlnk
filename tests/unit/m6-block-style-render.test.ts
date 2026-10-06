// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BLOCK_TYPES, type BlockType, type PublishDoc } from "@/lib/document";
import { PageRenderer } from "@/components/page/page-renderer";
import { blocks as fixtureBlocks, noirTokens } from "./fixtures/page-document";

/**
 * M6-45 on the renderer: every block type applies its own overrides as inline `--t-*` variables on
 * its own element, only for the keys that have a valid value, with the same markup in the editor
 * preview and on the live page; a block without overrides renders exactly as it did; nothing leaks
 * to a sibling, to the page root or to another block of the same type; a hostile value never
 * reaches the markup. What the variables do to colors, radii and borders is proven in a browser
 * (tests/e2e/m6/block-style-*.spec.ts); here the markup and the stylesheet's rules are checked.
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
const COLOR = "#C46A4F";
// M11-07: page_link has no editor form or renderer yet; those workers drop this filter with theirs.
const TYPES = BLOCK_TYPES.filter((type) => type !== "page_link" && type !== "items" && type !== "hours");

type Raw = Record<string, unknown>;
const block = (type: BlockType, extra: Raw = {}): Raw => ({ ...fixtureBlocks[type], ...extra });

function render(
  docBlocks: Raw[],
  mode: "live" | "preview" = "live",
  extra: { thumbnail?: boolean; inertEmbeds?: boolean } = {},
): string {
  const doc = {
    version: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: noirTokens,
    blocks: docBlocks,
  } as unknown as PublishDoc;
  return renderToStaticMarkup(
    createElement(PageRenderer, { doc, pageId: PAGE_ID, mode, ...extra }),
  );
}

const dom = (html: string): Document =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
const own = (html: string, id: string): HTMLElement =>
  dom(html).querySelector<HTMLElement>(`[data-block-id="${id}"]`)!;
const vars = (el: Element): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (el.getAttribute("style") ?? "").split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
};

const ALL = {
  accent: COLOR,
  buttonBg: COLOR,
  buttonText: COLOR,
  text: COLOR,
  textMuted: COLOR,
  surface: COLOR,
  border: COLOR,
  buttonStyle: "soft",
  radius: 20,
  borderWidth: 2,
};
const ALL_VARS = {
  "--t-accent": COLOR,
  "--t-button-bg": COLOR,
  "--t-button-text": COLOR,
  "--t-text": COLOR,
  "--t-text-muted": COLOR,
  "--t-surface": COLOR,
  "--t-border": COLOR,
  "--t-button-style": "soft",
  "--t-radius": "20px",
  "--t-border-width": "2px",
};

describe("M6-45 a block without overrides renders exactly as before", () => {
  it.each(TYPES.map((type) => [type]))("%s: no style, no data-bordered, same markup", (type) => {
    const plain = render([block(type)]);
    expect(plain).toBe(render([block(type, { overrides: undefined })]));
    // An empty set draws nothing either.
    expect(plain).toBe(render([block(type, { overrides: {} })]));
    // Keys that are not among the ten draw nothing.
    expect(plain).toBe(
      render([block(type, { overrides: { fontHeading: "Geist", bg: "#000000" } })]),
    );
    const el = own(plain, block(type).id as string);
    expect(el.hasAttribute("style"), type).toBe(false);
    expect(el.hasAttribute("data-bordered"), type).toBe(false);
  });

  it("a whole page of the nine types is byte-identical with and without empty overrides", () => {
    const plain = TYPES.map((type) => block(type));
    const empty = TYPES.map((type) => block(type, { overrides: {} }));
    expect(render(empty)).toBe(render(plain));
    expect(render(empty, "preview")).toBe(render(plain, "preview"));
  });
});

describe("M6-45 every renderer draws its own overrides, on its own element", () => {
  it.each(TYPES.map((type) => [type]))(
    "%s: the ten keys become inline --t-* variables, in the preview and live",
    (type) => {
      const el = own(render([block(type, { overrides: ALL })]), block(type).id as string);
      expect(vars(el)).toEqual(ALL_VARS);
      // Same markup in the editor preview and on the live page.
      expect(render([block(type, { overrides: ALL })], "preview")).toBe(
        render([block(type, { overrides: ALL })], "live"),
      );
    },
  );

  it.each(TYPES.map((type) => [type]))("%s: only the keys that have a value are drawn", (type) => {
    const el = own(
      render([block(type, { overrides: { text: COLOR, radius: 4 } })]),
      block(type).id as string,
    );
    expect(vars(el)).toEqual({ "--t-text": COLOR, "--t-radius": "4px" });
  });

  it("the variable sits on the block's own root element (the one with data-block-id)", () => {
    const html = render(TYPES.map((type) => block(type, { overrides: { text: COLOR } })));
    const d = dom(html);
    for (const type of TYPES) {
      const el = d.querySelector(`[data-block-id="${block(type).id}"]`)!;
      expect(el.getAttribute("data-block-type"), type).toBe(type);
      expect(vars(el), type).toEqual({ "--t-text": COLOR });
    }
    // Nothing else in the page carries an inline variable: not the root, the column, the cells or
    // the icons inside a block (the root's own variables are the page's resolved tokens).
    const inline = Array.from(d.querySelectorAll("[style]")).filter(
      (el) => !el.hasAttribute("data-page-root"),
    );
    expect(inline.map((el) => el.getAttribute("data-block-type")).sort()).toEqual(
      [...TYPES].sort(),
    );
    for (const cell of d.querySelectorAll(".pg-cell, .pg-social-link, .pg-image-img")) {
      expect(cell.hasAttribute("style")).toBe(false);
    }
  });

  it("an override never leaks to a sibling or to another block of the same type", () => {
    const a = block("header", { id: "header-aaaa-01", overrides: { text: COLOR } });
    const b = block("header", { id: "header-bbbb-02" });
    const c = block("divider", { id: "divider-cc-03" });
    const html = render([a, b, c]);
    expect(vars(own(html, "header-aaaa-01"))).toEqual({ "--t-text": COLOR });
    expect(own(html, "header-bbbb-02").hasAttribute("style")).toBe(false);
    expect(own(html, "divider-cc-03").hasAttribute("style")).toBe(false);
    // The siblings' markup is what it is without the neighbor's override.
    const without = render([block("header", { id: "header-aaaa-01" }), b, c]);
    expect(own(without, "header-bbbb-02").outerHTML).toBe(own(html, "header-bbbb-02").outerHTML);
    expect(own(without, "divider-cc-03").outerHTML).toBe(own(html, "divider-cc-03").outerHTML);
    // The page root keeps the page's own tokens: the override is not among its inline variables.
    const root = dom(html).querySelector("[data-page-root]")!;
    expect(vars(root)["--t-text"]).toBe(noirTokens.text);
  });

  it("no --hl- variable appears anywhere in the page", () => {
    const html = render(
      TYPES.map((type) => block(type, { overrides: ALL })),
      "preview",
    );
    expect(html).not.toMatch(/--hl-/);
  });

  it("the hex is drawn as stored, in any case the schema allows (a short or long form too)", () => {
    const el = own(
      render([block("divider", { overrides: { border: "#c46a4f" } })]),
      block("divider").id as string,
    );
    expect(vars(el)["--t-border"]).toBe("#c46a4f");
  });
});

describe("M6-45 an image has no border until it sets a border thickness", () => {
  const id = block("image").id as string;
  const flag = (overrides: Raw | undefined, extra: Raw = {}) =>
    own(render([block("image", { overrides, ...extra })]), id).getAttribute("data-bordered");

  it("data-bordered appears only when the block sets borderWidth", () => {
    expect(flag(undefined)).toBeNull();
    expect(flag({})).toBeNull();
    expect(flag({ radius: 20 })).toBeNull();
    expect(flag({ border: COLOR })).toBeNull();
    expect(flag({ borderWidth: 2 })).toBe("true");
    expect(flag({ borderWidth: 0 })).toBe("true");
    expect(flag({ borderWidth: 2, border: COLOR, radius: 20 })).toBe("true");
  });

  it("a bad thickness sets nothing: no attribute, no variable", () => {
    for (const borderWidth of [99, -1, "2", null, "2px; background:url(x)"]) {
      const el = own(render([block("image", { overrides: { borderWidth } })], "preview"), id);
      expect(el.hasAttribute("data-bordered"), String(borderWidth)).toBe(false);
      expect(el.hasAttribute("style"), String(borderWidth)).toBe(false);
    }
  });

  it("works with a shaped image and a linked image (the border is on the picture, inside the frame)", () => {
    const shaped = render([block("image", { shape: "square", overrides: { borderWidth: 2 } })]);
    const d = dom(shaped);
    expect(
      d.querySelector(".pg-image[data-bordered] .pg-image-frame > .pg-image-img"),
    ).not.toBeNull();
    const unlinked = render([block("image", { url: undefined, overrides: { borderWidth: 2 } })]);
    expect(dom(unlinked).querySelector(".pg-image[data-bordered] > .pg-image-img")).not.toBeNull();
    expect(dom(shaped).querySelector(".pg-image-link .pg-image-frame")).not.toBeNull();
  });

  it("the stylesheet draws the border only for a block with the attribute", () => {
    const css = readFileSync(
      resolve(join(process.cwd(), "src/components/page/page-renderer.css")),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: m[1]!.trim(),
      body: m[2]!,
    }));
    const imageBorders = rules.filter(
      (rule) => /\.pg-image/.test(rule.selector) && /(^|[\s;])border(-width)?\s*:/.test(rule.body),
    );
    expect(imageBorders.length).toBeGreaterThan(0);
    for (const rule of imageBorders) {
      expect(rule.selector, rule.selector).toContain("[data-bordered]");
      expect(rule.body).toMatch(/var\(--t-border-width\)/);
      expect(rule.body).toMatch(/var\(--t-border\)/);
    }
  });
});

describe("M6-45 what the stylesheet reads", () => {
  const css = readFileSync(
    resolve(join(process.cwd(), "src/components/page/page-renderer.css")),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleBody = (selector: string): string => {
    const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim() === selector);
    return found ? found[2]! : "";
  };

  it("the header's color is explicit, from the text token", () => {
    expect(ruleBody("[data-page-root] .pg-header")).toMatch(/color:\s*var\(--t-text\)/);
  });

  it.each([
    ["[data-page-root] .pg-text", /color:\s*var\(--t-text-muted\)/],
    ["[data-page-root] .pg-divider", /background:\s*var\(--t-border\)/],
    ["[data-page-root] .pg-social-link", /border:\s*1px solid var\(--t-border\)/],
    ["[data-page-root] .pg-social-link", /color:\s*var\(--t-text\)/],
    ["[data-page-root] .pg-cell", /border:\s*var\(--t-border-width\) solid var\(--t-border\)/],
    ["[data-page-root] .pg-cell", /border-radius:\s*var\(--t-radius\)/],
    ["[data-page-root] .pg-cell", /color:\s*var\(--t-text\)/],
    [
      "[data-page-root] .pg-embed-play",
      /border:\s*var\(--t-border-width\) solid var\(--t-border\)/,
    ],
    ["[data-page-root] .pg-embed-play", /border-radius:\s*var\(--t-radius\)/],
    [
      "[data-page-root] .pg-embed-iframe",
      /border:\s*var\(--t-border-width\) solid var\(--t-border\)/,
    ],
    ["[data-page-root] .pg-image-img", /border-radius:\s*var\(--t-radius\)/],
  ])("%s reads its variable explicitly: %s", (selector, expected) => {
    expect(ruleBody(selector)).toMatch(expected);
  });

  it("an override reaches nothing through a literal: every value above is a variable", () => {
    // The renderer stylesheet's own rules (no color literals, no --hl- reference) are checked in
    // renderer-static.test.ts; this only pins that the new rules add none.
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--hl-/);
  });
});

describe("M6-45 a hostile value never reaches the markup", () => {
  const HOSTILE = "#FFF;}</style><script>window.__x=1</script>";

  it("the editor preview serializes through the sanitizing step: the value is left out and no script appears", () => {
    for (const type of TYPES) {
      for (const overrides of [
        { text: HOSTILE },
        { border: HOSTILE, radius: -5 },
        { borderWidth: 99, textMuted: "red", accent: "url(javascript:alert(1))" },
        { radius: "20px; background: url(//evil.example/x)" },
      ]) {
        const html = render([block(type, { overrides })], "preview");
        expect(html, type).not.toMatch(/<script/i);
        expect(html, type).not.toContain("window.__x");
        expect(html, type).not.toContain("evil.example");
        expect(html, type).not.toContain("javascript:");
        // The bad keys are simply not drawn: the block follows the page for them.
        expect(dom(html).querySelector("script"), type).toBeNull();
        const el = own(html, block(type).id as string);
        expect(el.hasAttribute("style"), type).toBe(false);
      }
    }
  });

  it("a valid key beside a bad one is still drawn", () => {
    const el = own(
      render([block("header", { overrides: { text: COLOR, radius: -5 } })], "preview"),
      block("header").id as string,
    );
    expect(vars(el)).toEqual({ "--t-text": COLOR });
  });

  it("a non-object override draws nothing and does not throw", () => {
    for (const overrides of ["text", 5, [], null, true]) {
      expect(() => render([block("header", { overrides })], "preview")).not.toThrow();
    }
  });
});

describe("M6-45 incomplete blocks and small copies", () => {
  it("the editor preview's placeholder for an empty image or an unusable embed carries the style", () => {
    const image = block("image", { image: null, overrides: { radius: 4, border: COLOR } });
    const embed = block("embed", { url: "https://example.com/nope", overrides: { radius: 4 } });
    const html = render([image, embed], "preview");
    expect(vars(own(html, image.id as string))).toEqual({
      "--t-radius": "4px",
      "--t-border": COLOR,
    });
    expect(vars(own(html, embed.id as string))).toEqual({ "--t-radius": "4px" });
    // Nothing is drawn live for either, so there is nothing to style.
    expect(own(render([image, embed], "live"), image.id as string)).toBeNull();
  });

  it("a thumbnail and an inert-embed copy draw the same overrides as a normal preview", () => {
    const docBlocks = TYPES.map((type) => block(type, { overrides: { text: COLOR, radius: 20 } }));
    for (const extra of [{ thumbnail: true }, { inertEmbeds: true }]) {
      const html = render(docBlocks, "preview", extra);
      for (const type of TYPES) {
        expect(vars(own(html, block(type).id as string)), type).toEqual({
          "--t-text": COLOR,
          "--t-radius": "20px",
        });
      }
    }
  });
});
