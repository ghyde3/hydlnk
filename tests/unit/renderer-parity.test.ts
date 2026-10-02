// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PreviewPanel } from "@/components/editor/preview-panel";
import { TenantPage } from "@/components/tenant/tenant-page";
import { pageChrome } from "@/lib/publish/chrome";
import { fullPublished } from "./fixtures/page-document";

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

/**
 * M2-31 step 3, one renderer and not two: the same published document, drawn through the editor's
 * preview wrapper and through the public page component, gives identical HTML for [data-page-root];
 * and the two reach the one renderer module.
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

function rootHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const root = doc.querySelector("[data-page-root]");
  expect(root, "a [data-page-root] element").not.toBeNull();
  return root!.outerHTML;
}

describe("M2-31 the editor preview and the public page draw the same markup", () => {
  it.each(["free", "pro", "studio", "gibberish"])(
    "plan %s: [data-page-root] is identical through PreviewPanel and TenantPage",
    (plan) => {
      const preview = renderToStaticMarkup(
        createElement(PreviewPanel, {
          doc: fullPublished,
          pageId: PAGE_ID,
          chrome: pageChrome(plan, PAGE_ID),
          view: "preview",
          isDesktop: true,
        }),
      );
      const live = renderToStaticMarkup(
        createElement(TenantPage, { document: fullPublished, pageId: PAGE_ID, plan }),
      );
      expect(rootHtml(preview)).toBe(rootHtml(live));
      // And it is a whole page, not an empty shell: every block of the fixture is there.
      const blockIds = [...rootHtml(live).matchAll(/data-block-id="([^"]+)"/g)].map((m) => m[1]);
      expect(blockIds).toEqual(fullPublished.blocks.filter((b) => b.visible).map((b) => b.id));
    },
  );

  it("the preview wrapper and the public page both reach the one renderer module", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    expect(read("src/components/editor/preview-panel.tsx")).toMatch(
      /import\s*\{[^}]*\bPageRenderer\b[^}]*\}\s*from\s*"@\/lib\/editor\/contracts"/,
    );
    expect(read("src/lib/editor/contracts.ts")).toMatch(
      /export\s*\{\s*PageRenderer\s*\}\s*from\s*"@\/components\/page\/page-renderer"/,
    );
    expect(read("src/components/tenant/tenant-page.tsx")).toMatch(
      /import\s*\{\s*PageRenderer\s*\}\s*from\s*"@\/components\/page\/page-renderer"/,
    );
  });
});
