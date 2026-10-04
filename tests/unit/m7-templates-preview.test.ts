import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type Block, type DraftDoc, PROFILE_OPTION_DEFAULTS } from "@/lib/document";
import { PageRenderer } from "@/components/page/page-renderer";
import { TemplateDialog } from "@/components/templates";
import { TEMPLATES, describeTemplate, templatePreviewDoc, type Template } from "@/lib/templates";
import { SYSTEM_DEFAULT_TOKENS, resolveTokens, type TokenSet } from "@/lib/theme";
import { photoRef } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M7-07, the live preview on every template card: what it draws (the page applying would give, in
 * the template's own theme), that it is a picture and nothing else (no link, no iframe, no
 * heading in the accessibility tree, no network), and the card text around it.
 */

const MIDNIGHT: Partial<TokenSet> = { bg: "#0F1626", surface: "#18223A", accent: "#7AA2FF" };
const musician = TEMPLATES[0]!;

const profileOf = (over: Partial<DraftDoc["profile"]> = {}): DraftDoc["profile"] => ({
  ...emptyDraft("mara").profile,
  ...over,
});

const draw = (doc: ReturnType<typeof templatePreviewDoc>): string =>
  renderToStaticMarkup(
    createElement(PageRenderer, {
      doc,
      pageId: "template-preview",
      mode: "preview",
      thumbnail: true,
    }),
  );

describe("M7-07 templatePreviewDoc", () => {
  it("is the template's blocks, the person's profile and the template's theme, with no overrides", () => {
    const profile = profileOf({
      name: "Mara Okafor",
      bio: "My own bio",
      photo: photoRef,
      photoShape: "square",
    });
    const doc = templatePreviewDoc(profile, musician, MIDNIGHT);
    expect(doc.profile).toMatchObject({
      name: "Mara Okafor",
      bio: "My own bio",
      photo: { path: photoRef.path },
      photoShape: "square",
    });
    expect(doc.theme).toEqual({ ref: musician.theme.id, overrides: {} });
    expect(doc.tokens).toEqual(resolveTokens(MIDNIGHT, {}));
    expect(doc.tokens.bg).toBe("#0F1626");
    expect(doc.blocks.map((block) => block.type)).toEqual(
      musician.blocks.map((block) => block.type),
    );
    expect(doc.blocks.every((block) => block.visible === true)).toBe(true);
  });

  it("writes the template's sample bio when the person's is empty, which is what applying gives", () => {
    expect(templatePreviewDoc(profileOf({ bio: "" }), musician, MIDNIGHT).profile.bio).toBe(
      musician.bio,
    );
    expect(templatePreviewDoc(profileOf({ bio: "   " }), musician, MIDNIGHT).profile.bio).toBe(
      musician.bio,
    );
  });

  it("builds every address empty, so an embed or an image draws the dashed placeholder, never a link", () => {
    for (const template of TEMPLATES) {
      const doc = templatePreviewDoc(profileOf(), template, null);
      for (const block of doc.blocks) {
        // The publish form leaves out an empty optional address, so "" and absent are the same here.
        if ("url" in block) expect(block.url ?? "").toBe("");
        if (block.type === "image" || block.type === "card") expect(block.image).toBeNull();
        if (block.type === "social") {
          for (const icon of block.icons) {
            expect("url" in icon ? icon.url : icon.address).toBe("");
          }
        }
      }
    }
  });

  it("reads the profile only: a page with 50 blocks still previews the template's blocks", () => {
    const fifty: Block[] = Array.from({ length: 50 }, (_, i) => ({
      id: `Div${String(i).padStart(7, "0")}`,
      type: "divider",
      visible: true,
    }));
    // A function of the profile alone: the blocks of the page cannot get in.
    expect(templatePreviewDoc.length).toBe(3);
    const doc = templatePreviewDoc(profileOf(), musician, MIDNIGHT);
    expect(doc.blocks).toHaveLength(musician.blocks.length);
    expect(fifty).toHaveLength(50);
  });

  it("a theme that failed to load (null) draws the default colors", () => {
    const doc = templatePreviewDoc(profileOf(), musician, null);
    expect(doc.tokens).toEqual(resolveTokens(null, {}));
    expect(doc.tokens.bg).toBe(SYSTEM_DEFAULT_TOKENS.bg);
  });

  it("makes fresh ids each call and shares none within a page", () => {
    const a = templatePreviewDoc(profileOf(), musician, null);
    const b = templatePreviewDoc(profileOf(), musician, null);
    const ids = (doc: typeof a) => doc.blocks.map((block) => block.id);
    expect(new Set(ids(a)).size).toBe(a.blocks.length);
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
  });
});

describe("M7-07 the preview is a picture of the page, in the template's own theme", () => {
  it("draws the root with the theme's --t-* values and no --hl-* variable", () => {
    for (const template of TEMPLATES) {
      const html = draw(templatePreviewDoc(profileOf(), template, MIDNIGHT));
      expect(html).toContain("data-page-root");
      expect(html).toContain("--t-bg:#0F1626");
      expect(html).not.toMatch(/--hl-/);
    }
  });

  it("has no link, no iframe, no form control and no third-party address", () => {
    for (const template of TEMPLATES) {
      const html = draw(templatePreviewDoc(profileOf({ photo: photoRef }), template, MIDNIGHT));
      // React may hoist a preload hint for the photo (a <link>, to the same address as the image).
      const body = html.replace(/<link[^>]*>/g, "");
      expect(body).not.toMatch(/<a[\s>]/);
      expect(body).not.toMatch(/<iframe|<form|<input|<button|<script/);
      expect(body).not.toMatch(/href=/);
      // No absolute address anywhere but the canonical media origin (the root host's /media).
      expect(html.replace(/http:\/\/localhost:3000\/media\//g, "")).not.toMatch(/https?:\/\//);
      // The photo, when there is one, loads from that one origin.
      for (const match of html.matchAll(/src="([^"]+)"/g))
        expect(match[1]).toMatch(/^http:\/\/localhost:3000\/media\//);
    }
  });

  it("shows the dashed placeholders for the embed and image blocks of a template", () => {
    const musicianHtml = draw(templatePreviewDoc(profileOf(), musician, null));
    expect(musicianHtml).toContain("pg-placeholder");
    const artistHtml = draw(templatePreviewDoc(profileOf(), TEMPLATES[2]!, null));
    expect(artistHtml).toContain("pg-placeholder");
  });

  it("copes with a 60 character name, an empty name and every photo option", () => {
    for (const name of ["x".repeat(60), "", "Ünïcödé Name ✓"]) {
      for (const template of TEMPLATES) {
        const html = draw(
          templatePreviewDoc(
            profileOf({ name, photo: photoRef, ...PROFILE_OPTION_DEFAULTS }),
            template,
            MIDNIGHT,
          ),
        );
        expect(html).toContain("data-page-root");
      }
    }
  });
});

describe("M7-07 the card text", () => {
  const dialog = (draft: DraftDoc, themes: Record<string, Partial<TokenSet>> = {}) =>
    renderToStaticMarkup(
      createElement(TemplateDialog, {
        draft,
        themes,
        onUse: () => undefined,
        onClose: () => undefined,
      }),
    );
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("shows Inside and Style on every card, from the catalog, in the catalog's order", () => {
    const html = dialog(emptyDraft("mara"));
    const names = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((match) => match[1]);
    expect(names).toEqual(TEMPLATES.map((template) => template.name));
    for (const template of TEMPLATES) {
      expect(text(html)).toContain(`Inside: ${describeTemplate(template)}`);
      expect(text(html)).toContain(`Style: ${template.theme.name}`);
    }
  });

  it("has no strip of colors any more, and one 'Use this template' button per card", () => {
    const html = dialog(emptyDraft("mara"));
    expect(html).not.toContain("template-colors");
    expect(html.match(/data-use-template/g)).toHaveLength(6);
    for (const template of TEMPLATES) {
      expect(html).toContain(`aria-label="Use the ${template.name} template"`);
    }
  });

  it("puts a preview box on every card, hidden from assistive technology and inert", () => {
    const html = dialog(emptyDraft("mara"));
    const boxes = [...html.matchAll(/<div[^>]*data-testid="template-preview"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(boxes).toHaveLength(6);
    for (const box of boxes) {
      expect(box).toContain('aria-hidden="true"');
      expect(box).toContain("inert");
    }
  });

  it("loads at most one font stylesheet, naming the families of the themes, and none for no fonts url", () => {
    const html = dialog(emptyDraft("mara"));
    const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)];
    expect(links).toHaveLength(1);
    expect(links[0]![0]).toContain("fonts.googleapis.com/css2");
    expect(links[0]![0]).toContain("no-referrer");
  });

  it("does not draw the page behind it: every card shows the template's blocks only", () => {
    const fifty: DraftDoc = {
      ...emptyDraft("mara"),
      blocks: Array.from({ length: 50 }, (_, i): Block => ({
        id: `Div${String(i).padStart(7, "0")}`,
        type: "divider",
        visible: true,
      })),
    };
    // The pictures are drawn in the browser once a card is near the viewport; the markup here is the
    // card text, which is the same for a page with 50 blocks.
    expect(text(dialog(fifty))).toContain(`Inside: ${describeTemplate(musician as Template)}`);
  });
});

describe("M7-07 the preview imports no Supabase client and makes no network call", () => {
  const files = [
    ["src", "components", "templates", "template-preview.tsx"],
    ["src", "components", "templates", "template-choice.tsx"],
    ["src", "components", "templates", "template-dialog.tsx"],
    ["src", "lib", "templates", "preview.ts"],
    ["src", "lib", "templates", "describe.ts"],
    ["src", "lib", "templates", "fonts.ts"],
  ];
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it.each(files)("%s/%s/%s/%s", (...parts) => {
    const code = strip(readFileSync(join(process.cwd(), ...parts), "utf8"));
    expect(code).not.toMatch(/supabase/i);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/);
    expect(code).not.toMatch(/server-only|process\.env/);
    // Not through the editor's contracts either: that module re-exports the publish Server Action.
    expect(code).not.toMatch(/editor\/contracts|publish\/actions|analytics|beacon/i);
    for (const match of code.matchAll(/from\s+"([^"]+)"/g)) {
      expect(match[1]).toMatch(
        /^(react|\.\/|@\/lib\/(document|theme|design|templates)|@\/components\/page\/page-renderer)/,
      );
    }
  });
});
