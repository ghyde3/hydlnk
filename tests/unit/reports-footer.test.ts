// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PageRenderer } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import { pageChrome } from "@/lib/publish/chrome";
import { SYSTEM_DEFAULT_TOKENS, tokenSetSchema, type TokenSet } from "@/lib/theme";
import { blocks, fullPublished, noirTokens } from "./fixtures/page-document";
import { stackIsUp } from "./publish-support";

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
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * M5-05: the "Report this page" link is on every public page and no block, per-block override or
 * theme token can remove or restyle it out of view. The page is rendered under every system theme
 * (read from the local database when it is up, else under the default and Noir token sets), on
 * Free and Pro plans, with hostile overrides on the page and on a block.
 */
const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const REPORT_HREF = `http://localhost:3000/report?page=${PAGE_ID}`;

const { run } = await stackIsUp();

async function systemThemes(): Promise<{ name: string; tokens: TokenSet }[]> {
  const fallback = [
    { name: "default", tokens: SYSTEM_DEFAULT_TOKENS },
    { name: "Noir", tokens: noirTokens },
  ];
  if (!run) return fallback;
  const { createClient } = await import("@supabase/supabase-js");
  const admin: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin.from("themes").select("name, tokens").is("owner_id", null);
  if (error || !data) throw new Error(`reading system themes failed: ${error?.message}`);
  const themes = data.flatMap((row) => {
    const parsed = tokenSetSchema.safeParse(row.tokens);
    return parsed.success ? [{ name: String(row.name), tokens: parsed.data }] : [];
  });
  return themes.length > 0 ? themes : fallback;
}

function render(doc: PublishDoc, plan: string): Document {
  const html = renderToStaticMarkup(
    createElement(PageRenderer, {
      doc,
      pageId: PAGE_ID,
      mode: "live",
      chrome: pageChrome(plan, PAGE_ID),
    }),
  );
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

/** What a hostile tenant can put in a published document: every key the renderer might read. */
const hostile = (tokens: TokenSet): PublishDoc =>
  ({
    ...fullPublished,
    tokens: {
      ...tokens,
      scale: 0.8,
      density: "compact",
      maxWidth: 320,
      overlayOpacity: 1,
      blur: 24,
    },
    settings: { hideReport: true, hideFooter: true, footer: false },
    footer: { hidden: true },
    blocks: [
      {
        ...blocks.link,
        overrides: { accent: "#000000", buttonBg: "#000000", buttonStyle: "pill", radius: 32 },
        display: "none",
        style: "position:fixed;inset:0;z-index:99999;opacity:0",
        className: "pg-footer-link",
      },
      { ...blocks.divider, style: "display:none" },
    ],
  }) as unknown as PublishDoc;

describe("M5-05 the report link in every public page footer", () => {
  it("is present under every system theme, on Free and Pro, with hostile page and block settings", async () => {
    const themes = await systemThemes();
    expect(themes.length).toBeGreaterThanOrEqual(2);
    for (const { name, tokens } of themes) {
      for (const plan of ["free", "pro", "studio"]) {
        for (const doc of [
          fullPublished,
          hostile(tokens),
          { ...fullPublished, tokens, blocks: [] },
        ]) {
          const dom = render({ ...doc, tokens }, plan);
          const links = Array.from(dom.querySelectorAll("a")).filter(
            (a) => a.textContent === "Report this page",
          );
          expect(links, `${name}/${plan}`).toHaveLength(1);
          const link = links[0]!;
          expect(link.getAttribute("href")).toBe(REPORT_HREF);
          expect(link.hasAttribute("style"), `${name}/${plan} link style`).toBe(false);
          expect(link.hasAttribute("hidden")).toBe(false);
          expect(link.className).toBe("pg-footer-link");
          const footer = link.closest("footer")!;
          expect(footer.hasAttribute("style"), `${name}/${plan} footer style`).toBe(false);
          expect(footer.hasAttribute("hidden")).toBe(false);
          expect(footer.hasAttribute("data-block-id")).toBe(false);
          // Outside every block, so no block override or block-level style can reach it.
          expect(footer.closest("[data-block-id]")).toBeNull();
        }
      }
    }
  });

  it("the root's inline style carries only --t- variables: a token cannot add display, visibility or size rules", async () => {
    for (const { name, tokens } of await systemThemes()) {
      const root = render(hostile(tokens), "free").querySelector("[data-page-root]") as HTMLElement;
      const declarations = (root.getAttribute("style") ?? "")
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean);
      expect(declarations.length).toBeGreaterThan(10);
      for (const declaration of declarations) {
        expect(declaration, name).toMatch(/^--t-[a-z0-9-]+:/);
      }
    }
  });

  it("system themes keep the muted footer text readable on their background", async () => {
    if (!run) return;
    const { contrastRatio } = await import("@/lib/themes");
    for (const { name, tokens } of await systemThemes()) {
      expect(contrastRatio(tokens.textMuted, tokens.bg), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the footer's CSS lets a token change only its colour and font size, and keeps a 44px target", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/components/page/page-renderer.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]*\.pg-footer[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThanOrEqual(2);
    const declared: Record<string, string> = {};
    for (const [, , body] of rules) {
      for (const part of body!.split(";")) {
        const [property, ...value] = part.split(":");
        if (property?.trim()) declared[property.trim()] = value.join(":").trim();
      }
    }
    const tokenDriven = Object.entries(declared).filter(([, value]) => value.includes("var(--t-"));
    expect(tokenDriven.map(([property]) => property).sort()).toEqual(["color", "font-size"]);
    expect(declared["font-size"]).toBe("calc(13px * var(--t-scale))");
    expect(declared["min-height"]).toBe("44px");
    expect(declared["min-width"]).toBe("44px");
    expect(declared.display).toMatch(/flex/);
    for (const property of [
      "visibility",
      "opacity",
      "position",
      "clip",
      "transform",
      "height",
      "overflow",
    ]) {
      expect(declared[property], property).toBeUndefined();
    }
  });

  it("no theme or block rule in the stylesheet or the token CSS targets the footer", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/components/page/page-renderer.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    // Every rule that mentions the footer is under [data-page-root], and none sits inside a block.
    for (const [, selector] of css.matchAll(/([^{}]*\.pg-footer[^{}]*)\{/g)) {
      expect(selector!.trim(), selector).toMatch(/^\[data-page-root\]/);
      expect(selector).not.toMatch(/data-block|\.pg-block/);
    }
    for (const file of ["src/lib/theme/css.ts", "src/lib/theme/tokens.ts"]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/pg-footer|data-page-footer/);
    }
  });
});
