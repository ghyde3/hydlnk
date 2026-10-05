import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterCss, parseCss, serializeCss } from "@/lib/tenant-assets/css-split";
import {
  STYLED_BLOCK_TYPES,
  STYLED_PAGE_FEATURES,
  pageRulesCss,
  tenantInlineCss,
  tenantStateCss,
} from "@/lib/tenant-assets/css";
import { BLOCK_TYPES } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS } from "@/lib/theme";

/**
 * M8-02 step 3: the live page's one <style> element, extracted from the two CSS files the editor
 * preview imports. Only the block types the page holds, no second copy of the CSS, nothing a tenant
 * wrote in it.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const RENDERER = read("src/components/page/page-renderer.css");
const TENANT = read("src/app/(tenant)/tenant.css");

const tokens = SYSTEM_DEFAULT_TOKENS;
const css = (types: string[], tok: Record<string, unknown> = tokens) =>
  tenantInlineCss({ blocks: types.map((type) => ({ type })), tokens: tok });

describe("the CSS reader and minifier", () => {
  it("drops comments and whitespace, keeps strings, parentheses and the cascade order", () => {
    const source = `
      /* a comment; with { braces } */
      a   >   b ,  .c:hover {
        color : red ;  /* trailing */
        margin: 0  auto;
        content: "a;b, c";
        background: linear-gradient( 105deg , transparent 38% , color-mix(in srgb, red 20%, blue) 50% )
      }
      @container (max-width: 319px) { .d { width: calc(1px + 2px) } }
    `;
    expect(serializeCss(parseCss(source))).toBe(
      `a>b,.c:hover{color:red;margin:0 auto;content:"a;b, c";` +
        `background:linear-gradient(105deg,transparent 38%,color-mix(in srgb,red 20%,blue) 50%)}` +
        `@container (max-width:319px){.d{width:calc(1px + 2px)}}`,
    );
  });

  it("refuses CSS nesting and @font-face instead of guessing", () => {
    expect(() => parseCss(".a { .b { color: red } }")).toThrow(/nesting/);
    expect(() => parseCss("@font-face { font-family: x }")).toThrow(/font-face/);
  });

  it("filters selectors one by one, drops empty rules and groups, and prunes unused keyframes", () => {
    const source = `
      .keep, .drop { color: red }
      .drop { color: blue }
      @media (prefers-reduced-motion: no-preference) {
        .keep { animation: used 1s }
        .drop { animation: unused 1s }
        @keyframes used { 0%, 100% { opacity: 0 } 50% { opacity: 1 } }
        @keyframes unused { to { opacity: 0 } }
      }
      @container (max-width: 100px) { .drop { width: 1px } }
    `;
    const out = serializeCss(filterCss(parseCss(source), (selector) => selector !== ".drop"));
    expect(out).toBe(
      ".keep{color:red}@media (prefers-reduced-motion:no-preference){.keep{animation:used 1s}" +
        "@keyframes used{0%,100%{opacity:0}50%{opacity:1}}}",
    );
  });
});

describe("M8-02 step 3: the renderer rules a page needs", () => {
  const linkOnly = css(["link"]);
  const all = css([...BLOCK_TYPES]);

  it("knows every block type of the document model", () => {
    expect([...STYLED_BLOCK_TYPES].sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it("a page with only link blocks has none of the other block types' selectors", () => {
    for (const selector of [".pg-embed", ".pg-card", ".pg-grid", ".pg-social", ".pg-image"]) {
      expect(linkOnly, selector).not.toContain(selector);
    }
    expect(linkOnly).toContain(".pg-link");
    expect(linkOnly).toContain(".pg-profile");
    expect(linkOnly).toContain(".pg-footer");
    expect(linkOnly.length).toBeLessThan(all.length);
  });

  it("a page with all nine block types has a rule for every block type it holds", () => {
    for (const type of BLOCK_TYPES) {
      const prefixes: Record<string, string[]> = {
        link: [".pg-link"],
        card: [".pg-card"],
        header: [".pg-header"],
        text: [".pg-text"],
        divider: [".pg-divider"],
        image: [".pg-image"],
        social: [".pg-social"],
        embed: [".pg-embed"],
        grid: [".pg-grid", ".pg-cell"],
        faq: [".pg-faq", ".pg-faq-item", ".pg-faq-q", ".pg-faq-a"],
        contact: [".pg-contact", ".pg-contact-name", ".pg-contact-save"],
        discount: [".pg-discount", ".pg-discount-code", ".pg-discount-copy"],
        book: [".pg-book", ".pg-book-link"],
        apps: [".pg-apps", ".pg-app-badge"],
        map: [".pg-map", ".pg-map-link"],
        page_link: [".pg-link"],
        // M12-01, M12-02: no rules until the renderer worker lands them.
        items: [],
        hours: [],
      };
      for (const prefix of prefixes[type]!) expect(all, `${type}: ${prefix}`).toContain(prefix);
    }
  });

  it("with every block type the page carries every renderer rule the live page can use", () => {
    const flat = (nodes: ReturnType<typeof parseCss>): string[] =>
      nodes.flatMap((node) =>
        node.kind === "rule" ? node.selectors : node.kind === "group" ? flat(node.children) : [],
      );
    const wanted = flat(parseCss(RENDERER)).filter(
      (selector) =>
        !selector.includes("[data-page-frame]") && !selector.includes(".pg-placeholder"),
    );
    // Every block type and every page feature (the banner, the logo, the name style: M9-23, M9-24).
    const got = new Set(flat(parseCss(pageRulesCss([...BLOCK_TYPES], STYLED_PAGE_FEATURES))));
    for (const selector of wanted) expect(got.has(selector), selector).toBe(true);
  });

  it("leaves the editor-only rules out: the phone bezel and the empty-block placeholder", () => {
    expect(all).not.toContain("data-page-frame");
    expect(all).not.toContain("pg-placeholder");
    expect(RENDERER).toContain("data-page-frame");
  });

  it("includes the featured-link animation only with link blocks, with its keyframes", () => {
    expect(linkOnly).toContain("@keyframes pg-featured-pulse");
    const noLink = css(["divider"]);
    expect(noLink).not.toContain("pg-featured");
    expect(noLink).not.toContain("@keyframes");
    expect(noLink).not.toContain("prefers-reduced-motion");
  });

  it("ignores a block type this version does not know and the order and repeats of types", () => {
    expect(css(["future-block", "link", "link"])).toBe(css(["link"]));
    expect(css(["embed", "link"])).toBe(css(["link", "embed"]));
    expect(css([])).not.toContain(".pg-link");
  });

  it("an empty page still has the profile, footer, background and shared rules", () => {
    const empty = css([]);
    for (const selector of [".pg-profile", ".pg-footer", ".pg-bg", ".pg-column", ".pg-blocks"]) {
      expect(empty, selector).toContain(selector);
    }
  });
});

describe("M8-02 step 3: minified, and nothing tenant-written in it", () => {
  const all = css([...BLOCK_TYPES]);

  it("is one minified line with no comment, no newline and no @import", () => {
    expect(all).not.toMatch(/\n|\/\*|@import/);
    expect(all.length).toBeLessThan(RENDERER.length + TENANT.length);
    // The whole renderer stylesheet is 25 KB of source; a page needs a good deal less.
    expect(all.length).toBeLessThan(RENDERER.length * 0.75);
  });

  it("keeps the rules the static scans of M2-05 and M6-34 hold: container queries only, no color literals, no --hl- variables", () => {
    expect(all).not.toMatch(/--hl-/);
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(all).not.toMatch(/\brgba?\(/);
    const media = [...all.matchAll(/@media[^{]*/g)].map((match) => match[0]);
    for (const query of media) expect(query).toContain("prefers-reduced-motion");
    expect(all).toContain("@container");
    expect(all).not.toMatch(/\d(?:vw|vh)\b/);
  });

  it("two pages with the same block types and fonts get byte-identical CSS, whatever they say and look like", () => {
    const one = css(["link", "card", "text"], {
      ...tokens,
      bg: "#112233",
      accent: "#FF0000",
      scale: 1.1,
      bgImage: "https://x.test/a.png",
    });
    const two = css(["text", "card", "link"], {
      ...tokens,
      bg: "#00FF00",
      radius: 0,
      bgType: "gradient",
    });
    expect(one).toBe(two);
  });

  it("a hostile token string reaches no rule: the CSS depends on the font tokens alone", () => {
    const hostile = css(["link"], {
      ...tokens,
      fontHeading: "Evil;}body{x:y",
      fontBody: "Geist, sans-serif",
      text: "</style><script>alert(1)</script>",
    });
    expect(hostile).not.toMatch(/Evil|alert|<\/style>|<script/);
    expect(hostile).toBe(css(["link"]));
  });
});

describe("M8-03: the CSS of the placeholder, the 404 panels and the error panel", () => {
  it("is all of tenant.css, minified, with no renderer rule", () => {
    const state = tenantStateCss();
    for (const selector of [
      ".tenant-root",
      ".tenant-notfound",
      ".tenant-unclaimed",
      ".tenant-note",
    ]) {
      expect(state, selector).toContain(selector);
    }
    expect(state).not.toContain("pg-");
    expect(state).not.toMatch(/\n|\/\*/);
  });

  it("the page's base rules are the html and body resets only (no .tenant-* class)", () => {
    const base = pageRulesCss([]).slice(0, 120);
    expect(base.startsWith("html{-webkit-text-size-adjust:100%}body{margin:0}")).toBe(true);
    expect(pageRulesCss([BLOCK_TYPES[0]])).not.toContain(".tenant-");
  });
});
