// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PreviewBezel } from "@/components/workspace/preview-bezel";
import { pageChrome } from "@/lib/publish/chrome";
import { PARITY_DOCS } from "./fixtures/m8-render-docs";

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
// The preview wrapper imports the publish Server Action through the editor contracts module.
vi.mock("@/lib/publish/actions", () => ({ publishPage: vi.fn() }));
vi.mock("@/lib/publish/unpublish-action", () => ({ unpublishSite: vi.fn() }));

const { renderLivePage } = await import("@/lib/tenant-render/live-page");
const { provideEmbedFacade } = await import("@/components/page/embed-slot");
const { EmbedFacade } = await import("@/components/page/embed-facade");
const { EmbedFacadeMarkup } = await import("@/components/page/embed-facade-markup");

// The editor's seam registers the React facade for the preview (src/lib/editor/contracts.ts). The live
// route handler is a different module graph in the real build, so it never sees that registration;
// in one test process the two share the module, so each side sets its own facade before it renders.
const asPreview = () => provideEmbedFacade(EmbedFacade);
const asLive = () => provideEmbedFacade(EmbedFacadeMarkup);

/**
 * M2-31 step 3, one renderer and not two: the same published document, drawn through the editor's
 * preview wrapper (React in the browser) and through the live page builder (finished HTML built on
 * the server, M8-02), gives identical HTML for [data-page-root]; and the two reach the one renderer
 * module. M8-08 runs it on the M2-31 nine-block fixture and on the Wave G fixture (all eight embed
 * providers, link icons and thumbnails, a featured link, image focus and shapes, text marks, a share
 * card, a gradient, block overrides, a profile photo with options).
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

function rootHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const root = doc.querySelector("[data-page-root]");
  expect(root, "a [data-page-root] element").not.toBeNull();
  return root!.outerHTML;
}

describe("M2-31 the editor preview and the public page draw the same markup", () => {
  describe.each(PARITY_DOCS)("%s", (_name, doc) => {
    it.each(["free", "pro", "studio", "gibberish"])(
      "plan %s: [data-page-root] is identical through PreviewBezel and the live builder",
      (plan) => {
        asPreview();
        const preview = renderToStaticMarkup(
          createElement(PreviewBezel, {
            doc,
            pageId: PAGE_ID,
            chrome: pageChrome(plan, PAGE_ID),
          }),
        );
        asLive();
        const live = renderLivePage({ pageId: PAGE_ID, document: doc, plan, urls: null });
        expect(rootHtml(preview)).toBe(rootHtml(live));
        // And it is a whole page, not an empty shell: every block of the fixture is there.
        const blockIds = [...rootHtml(live).matchAll(/data-block-id="([^"]+)"/g)].map((m) => m[1]);
        expect(blockIds).toEqual(doc.blocks.filter((b) => b.visible).map((b) => b.id));
      },
    );
  });

  it("the full live document differs from the editor's markup only by the head, the style, the preloads and the one script", () => {
    asLive();
    const [, doc] = PARITY_DOCS[1]!;
    const html = renderLivePage({ pageId: PAGE_ID, document: doc, plan: "free", urls: null });
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const extra = [...parsed.body.children]
      .filter((el) => !el.hasAttribute("data-page-root"))
      .map((el) => el.tagName.toLowerCase());
    expect(extra).toEqual(["script"]);
    expect([...parsed.head.children].every((el) => ["meta", "title", "link", "style"].includes(el.tagName.toLowerCase()))).toBe(true);
  });

  it("the preview wrapper and the live builder both reach the one renderer module", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    expect(read("src/components/workspace/preview-bezel.tsx")).toMatch(
      /import\s*\{[^}]*\bPageRenderer\b[^}]*\}\s*from\s*"@\/lib\/editor\/contracts"/,
    );
    expect(read("src/lib/editor/contracts.ts")).toMatch(
      /export\s*\{\s*PageRenderer\s*\}\s*from\s*"@\/components\/page\/page-renderer"/,
    );
    expect(read("src/lib/tenant-render/live-page.tsx")).toMatch(
      /import\s*\{\s*PageRenderer\s*\}\s*from\s*"@\/components\/page\/page-renderer"/,
    );
  });
});
