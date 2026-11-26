// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { blockDefaults, toPublishForm, type FormBlock, type PublishDoc } from "@/lib/document";
import { fullDraft, noirTokens } from "./fixtures/page-document";
import { PAGE_ID, waveGPublished } from "./fixtures/m8-render-docs";

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
const mocks = vi.hoisted(() => ({ byId: vi.fn(), index: vi.fn() }));
vi.mock("@/app/(tenant)/published-page", () => ({ getTenantPageStateById: mocks.byId }));
vi.mock("@/lib/site/published", () => ({ getSiteIndex: mocks.index }));

const { renderLivePage, renderLiveSubPage, formPixel } =
  await import("@/lib/tenant-render/live-page");
const { renderFormPage } = await import("@/lib/tenant-render/form-page");
const { TENANT_SCRIPT_SRC } = await import("@/lib/tenant-assets");

/**
 * M17-04 step 3 and M17-06: the open marker is in a live document only when the page holds a visible
 * form block, and a page without one is byte-identical to before; the three result pages are
 * finished, `noindex` documents with no script and no marker, drawn on the site's theme.
 */

const URLS = { page: "http://mara.localhost:3000/", image: "http://mara.localhost:3000/og?v=1" };
const FORM: FormBlock = {
  ...(blockDefaults.form() as FormBlock),
  id: "formSign01",
  heading: "<b>News</b>",
};
const PIXEL = `<img src="/f/${PAGE_ID}/o" alt="" width="1" height="1" aria-hidden="true" style="position:absolute;left:-9999px">`;
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const withBlocks = (blocks: PublishDoc["blocks"]): PublishDoc => ({ ...waveGPublished, blocks });

describe("M17-04 the open marker in the live documents", () => {
  it("a page without a form block draws no marker and no form markup", () => {
    expect(waveGPublished.blocks.some((block) => block.type === "form")).toBe(false);
    const html = renderLivePage({
      pageId: PAGE_ID,
      document: waveGPublished,
      plan: "free",
      urls: URLS,
    });
    expect(html).not.toContain(`/f/${PAGE_ID}`);
    expect(html).not.toContain("pg-form");
    expect(html).not.toContain("<form");
    expect(formPixel(PAGE_ID, waveGPublished.blocks)).toBe("");
  });

  it("a page with a visible form block draws the one marker between the root and the script", () => {
    const html = renderLivePage({
      pageId: PAGE_ID,
      document: withBlocks([...waveGPublished.blocks, FORM]),
      plan: "free",
      urls: URLS,
    });
    expect(html.split(PIXEL)).toHaveLength(2);
    expect(html.indexOf(PIXEL)).toBeLessThan(html.indexOf(TENANT_SCRIPT_SRC));
    const doc = parse(html);
    expect(doc.querySelector(`form[action="/f/${PAGE_ID}/formSign01"]`)).not.toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(html).toContain("&lt;b&gt;News&lt;/b&gt;");
  });

  it("a hidden form block draws no marker", () => {
    expect(formPixel(PAGE_ID, [{ type: "form", visible: false }])).toBe("");
  });

  it("a sub-page with a form draws its marker too", () => {
    const html = renderLiveSubPage({
      pageId: PAGE_ID,
      subPageId: "e1e1e1e1-0000-4000-8000-000000000001",
      document: waveGPublished,
      subPage: { path: "about", title: "About", description: "", blocks: [FORM] } as never,
      plan: "free",
      site: { hrefs: {}, menu: null } as never,
      urls: null,
    });
    expect(html).toContain(PIXEL);
  });

  it("the marker's page id must be a UUID", () => {
    expect(() => formPixel("../evil", [FORM])).toThrow();
  });
});

describe("M17-06 the result pages", () => {
  const doc = toPublishForm({ ...fullDraft, blocks: [FORM] }, noirTokens);
  mocks.byId.mockResolvedValue({
    kind: "published",
    page: { pageId: PAGE_ID, document: doc, publishedAt: null, plan: "free" },
  });
  mocks.index.mockResolvedValue([
    { id: "e1e1e1e1-0000-4000-8000-000000000001", path: "about", title: "About" },
  ]);
  const target = { block: FORM, handle: "mara", customHosts: [] };

  it.each([
    ["confirm", "Check and send"],
    ["error", "Fix and send"],
    ["sent", "Sent"],
  ] as const)(
    "%s: one finished document, titled, noindex, no script and no marker",
    async (view, title) => {
      const html = await renderFormPage({
        pageId: PAGE_ID,
        target,
        state: {
          blockId: FORM.id,
          view,
          values: { email: '"><script>alert(1)</script>', name: "", message: "" },
          token: "v1.1.x",
        },
      });
      expect(html).not.toBeNull();
      const page = parse(html!);
      expect(page.title).toBe(`${title} · ${doc.profile.name}`);
      expect(page.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex");
      expect(page.querySelector("h1")!.textContent).toBe(title);
      expect(page.querySelectorAll("script")).toHaveLength(0);
      expect(html).not.toContain("/f/" + PAGE_ID + "/o");
      expect(html).not.toContain("<script>alert(1)");
      expect(page.querySelector(".pg-form-heading")).toBeNull();
      expect(page.querySelector("[data-page-root]")!.getAttribute("style")).toContain("--t-");
      expect(html).not.toContain("--hl-");
    },
  );

  it("sent: Back leads to Home, or to the sub-page that holds the form", async () => {
    const home = parse(
      (await renderFormPage({
        pageId: PAGE_ID,
        target,
        state: { blockId: FORM.id, view: "sent" },
      }))!,
    );
    expect(home.querySelector(".pg-form-back")!.getAttribute("href")).toBe("/");
    const sub = parse(
      (await renderFormPage({
        pageId: PAGE_ID,
        target: { ...target, subPageId: "e1e1e1e1-0000-4000-8000-000000000001" },
        state: { blockId: FORM.id, view: "sent" },
      }))!,
    );
    expect(sub.querySelector(".pg-form-back")!.getAttribute("href")).toBe("/about");
    expect(sub.querySelector('[role="status"]')!.textContent).toBe(FORM.successMessage);
  });

  it("a site that is no longer published draws nothing", async () => {
    mocks.byId.mockResolvedValueOnce({ kind: "unpublished", pageId: PAGE_ID });
    expect(
      await renderFormPage({ pageId: PAGE_ID, target, state: { blockId: FORM.id, view: "sent" } }),
    ).toBeNull();
  });
});
