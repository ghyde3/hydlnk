// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { draftDocSchema, toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import { parseCss } from "@/lib/tenant-assets/css-split";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
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

const { tenantInlineCss, pageRulesCss, pageFeaturesOf } = await import("@/lib/tenant-assets/css");
const { renderLivePage } = await import("@/lib/tenant-render/live-page");

/**
 * M9-23: the support banner in the shared renderer and in the live page's stylesheet. One component
 * draws it for the live page and the editor preview (the markup is the same in both modes); its
 * rules are in the page's `<style>` only when the page has a banner.
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b9";
const BANNER_ID = "banner-0001a";
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const draft = (banner?: Record<string, unknown>): DraftDoc =>
  draftDocSchema.parse({
    ...(draftWith(blocks.link, blocks.header) as object),
    profile: { name: "Mara Okafor", bio: "Orlando, FL", photo: null },
    ...(banner ? { banner } : {}),
  }) as DraftDoc;
const base = {
  id: BANNER_ID,
  visible: true,
  text: "Free shipping this week",
  label: "Shop",
  url: "https://shop.example/sale",
};
const form = (banner?: Record<string, unknown>): PublishDoc =>
  toPublishForm(draft(banner), noirTokens);
const draw = (doc: PublishDoc, mode: "live" | "preview" = "live", thumbnail = false): string =>
  renderToStaticMarkup(
    createElement(PageRenderer, {
      doc,
      pageId: PAGE_ID,
      mode,
      ...(thumbnail ? { thumbnail } : {}),
    }),
  );
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("M9-23 the markup", () => {
  const html = draw(form(base));
  const root = dom(html).querySelector<HTMLElement>("[data-page-root]")!;

  it("is the first child of the page root, before the profile column", () => {
    const children = [...root.children];
    expect(children[0]!.tagName).toBe("ASIDE");
    expect(children[0]!.id).toBe("pg-banner");
    expect(children[1]!.classList.contains("pg-column")).toBe(true);
    expect(root.hasAttribute("data-banner")).toBe(true);
  });

  it("is an aside named Message with the text, the link and the dismiss anchor, in that order", () => {
    const aside = root.querySelector("aside")!;
    expect(aside.className).toBe("pg-banner");
    expect(aside.getAttribute("aria-label")).toBe("Message");
    expect([...aside.children].map((el) => `${el.tagName}.${el.className}`)).toEqual([
      "P.pg-banner-text",
      "A.pg-banner-link",
      "A.pg-banner-dismiss",
    ]);
    expect(aside.querySelector(".pg-banner-text")!.textContent).toBe("Free shipping this week");
    const link = aside.querySelector<HTMLAnchorElement>(".pg-banner-link")!;
    expect(link.textContent).toBe("Shop");
    expect(link.getAttribute("href")).toBe(`/r/${PAGE_ID}/${BANNER_ID}`);
    expect(link.getAttribute("rel")).toContain("noopener");
    const dismiss = aside.querySelector<HTMLAnchorElement>(".pg-banner-dismiss")!;
    expect(dismiss.getAttribute("href")).toBe("#pg-banner");
    expect(dismiss.getAttribute("aria-label")).toBe("Dismiss message");
    expect(dismiss.textContent).toBe("×");
  });

  it("never holds the destination: the address is read by the server at /r from the published document", () => {
    expect(html).not.toContain("shop.example");
  });

  it("a message alone has no link element", () => {
    const only = draw(form({ ...base, label: "", url: "" }));
    expect(only).toContain("pg-banner-text");
    expect(only).toContain("pg-banner-dismiss");
    expect(only).not.toContain("pg-banner-link");
  });

  it("a page without a banner has no aside, no data-banner and no pg-banner anywhere", () => {
    const plain = draw(form());
    expect(plain).not.toContain("pg-banner");
    expect(plain).not.toContain("data-banner");
    expect(plain).not.toContain("<aside");
  });

  it("hidden banners and empty ones draw nothing: a hidden banner's text appears nowhere", () => {
    const hidden = draw(form({ ...base, visible: false, text: "SECRET-HIDDEN-TEXT" }));
    expect(hidden).not.toContain("SECRET-HIDDEN-TEXT");
    expect(hidden).not.toContain("pg-banner");
    expect(draw(form({ ...base, text: "", label: "", url: "" }))).not.toContain("pg-banner");
  });

  it("the message and the label are React text: markup in them is escaped", () => {
    const hostile = draw(
      form({ ...base, text: "<img src=x onerror=alert(1)>", label: "<b>Shop</b>" }),
    );
    expect(hostile).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(hostile).toContain("&lt;b&gt;Shop&lt;/b&gt;");
    expect(dom(hostile).querySelector("aside img")).toBeNull();
    expect(dom(hostile).querySelector("aside b")).toBeNull();
  });

  it("the preview and the live page draw identical markup (parity in both modes)", () => {
    expect(draw(form(base), "preview")).toBe(draw(form(base), "live"));
  });

  it("in a thumbnail (the phone dock) it is plain text: no anchor, no id, no label", () => {
    const thumb = dom(draw(form(base), "preview", true));
    const aside = thumb.querySelector(".pg-banner")!;
    expect(aside.tagName).toBe("DIV");
    expect(aside.querySelector("a")).toBeNull();
    expect(aside.id).toBe("");
    expect(aside.textContent).toBe("Free shipping this week");
  });

  it("the dismiss anchor is the one same-page anchor: every other anchor on the page is /r/ or a fragment of the banner", () => {
    const anchors = [...dom(html).querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    for (const href of anchors) {
      expect(href.startsWith("/r/") || href === "#pg-banner" || href.startsWith("mailto:")).toBe(
        true,
      );
    }
  });

  it("ships no script, storage or cookie code of its own", () => {
    const source = read("src/components/page/banner.tsx");
    expect(source).not.toMatch(
      /localStorage|sessionStorage|document\.cookie|"use client"|useEffect/,
    );
  });
});

describe("M9-23 the stylesheet", () => {
  const tokens = noirTokens;
  const css = (banner: unknown) =>
    tenantInlineCss({ blocks: [{ type: "link" }], tokens, ...(banner ? { banner } : {}) });

  it("a page without a banner carries none of its rules", () => {
    const without = css(undefined);
    expect(without).not.toContain("pg-banner");
    expect(without).not.toContain("data-banner");
    expect(without).toBe(tenantInlineCss({ blocks: [{ type: "link" }], tokens }));
    expect(pageFeaturesOf({})).toEqual([]);
  });

  it("a page with a banner carries them, and the dismissal is :target and nothing else", () => {
    const withIt = css({ id: BANNER_ID });
    expect(withIt).toContain(".pg-banner:target{display:none}");
    expect(withIt).toContain("[data-page-root][data-banner]");
    expect(withIt).toContain(".pg-banner-link");
    expect(withIt).toContain(".pg-banner-dismiss");
    expect(pageFeaturesOf({ banner: { id: BANNER_ID } })).toEqual(["banner"]);
    // The bytes the banner adds are only its own rules.
    expect(withIt.length).toBeGreaterThan(css(undefined).length);
  });

  it("is drawn with the surface, text, border and accent tokens: no color literal, no viewport unit", () => {
    const added = css({ id: BANNER_ID }).replace(css(undefined), "");
    expect(added.length).toBeGreaterThan(0);
    const rules = [...parseCss(read("src/components/page/page-renderer.css"))]
      .flatMap((node) => (node.kind === "rule" ? [node] : []))
      .filter((node) => node.selectors.some((s) => s.includes("pg-banner")));
    const text = rules.map((rule) => rule.decls).join(";");
    expect(text).toContain("var(--t-surface)");
    expect(text).toContain("var(--t-text)");
    expect(text).toContain("var(--t-border)");
    expect(text).toContain("var(--t-accent)");
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl|\d(?:vw|vh)\b/);
    expect(text).toMatch(/min-height:\s*44px/);
    expect(text).not.toMatch(/position:\s*sticky|position:\s*fixed/);
  });

  it("the live page puts the rules in its one <style> only when the page has a banner", () => {
    const urls = { page: "http://mara.localhost:3000/", image: "http://mara.localhost:3000/og" };
    const plain = renderLivePage({ pageId: PAGE_ID, document: form(), plan: "pro", urls });
    const withBanner = renderLivePage({ pageId: PAGE_ID, document: form(base), plan: "pro", urls });
    const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(styleOf(plain)).not.toContain("pg-banner");
    expect(styleOf(withBanner)).toContain("pg-banner");
    // The body has the aside as the root's first child, with the same markup the preview draws.
    expect(withBanner).toContain('<aside class="pg-banner" id="pg-banner" aria-label="Message">');
    expect(withBanner).toContain(`href="/r/${PAGE_ID}/${BANNER_ID}"`);
    expect(withBanner).not.toContain("shop.example");
    // No cookie, storage or script of the banner's: the one tenant script is the only <script>.
    expect((withBanner.match(/<script/g) ?? []).length).toBe(1);
    // A page without a banner is the same document it always was (no banner marker anywhere).
    expect(plain).not.toContain("data-banner");
  });

  it("every rule is scoped under the page root, as the renderer's static rules require", () => {
    const rules = parseCss(read("src/components/page/page-renderer.css"));
    const flat = (nodes: ReturnType<typeof parseCss>): string[] =>
      nodes.flatMap((n) =>
        n.kind === "rule" ? n.selectors : n.kind === "group" ? flat(n.children) : [],
      );
    for (const selector of flat(rules).filter((s) => s.includes("pg-banner"))) {
      expect(selector.startsWith("[data-page-root]"), selector).toBe(true);
    }
  });

  it("unrelated block types do not pull the banner's rules in", () => {
    expect(pageRulesCss(["link", "card"])).not.toContain("pg-banner");
    expect(pageRulesCss(["link"], ["banner"])).toContain("pg-banner");
  });
});
