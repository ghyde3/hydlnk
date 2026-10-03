// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Block, PublishDoc } from "@/lib/document";
import { PageRenderer } from "@/components/page/page-renderer";
import { blocks, noirTokens } from "./fixtures/page-document";

/**
 * M6-23: a block that has no shape and no focus (every block that exists today) keeps byte-identical
 * markup. These snapshots were taken from the renderer as it was before the focus and shape work,
 * so any drift in the unshaped image or the card shows up here.
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

function blockHtml(block: Block, mode: "live" | "preview" = "live"): string {
  const doc: PublishDoc = {
    version: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: noirTokens,
    blocks: [block],
  };
  const html = renderToStaticMarkup(createElement(PageRenderer, { doc, pageId: PAGE_ID, mode }));
  const start = html.indexOf(`data-block-id="${block.id}"`);
  const open = html.lastIndexOf("<", start);
  // The block's own element: from its opening tag to the end of the column that holds it.
  const end = html.indexOf("</main>", open);
  return html.slice(open, end === -1 ? undefined : end);
}

describe("M6-23 existing image and card blocks keep their markup", () => {
  it("an image block without a link", () => {
    expect(blockHtml({ ...blocks.image, url: undefined } as Block)).toMatchInlineSnapshot(
      `"<div class="pg-image" data-block-id="image-studio-1" data-block-type="image"><img class="pg-image-img" src="https://media.test/page-media/6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/night-market-banner.webp" alt="The studio at golden hour" width="1200" height="480" loading="lazy" decoding="async" referrerPolicy="no-referrer"/></div>"`,
    );
  });

  it("an image block with a link", () => {
    expect(blockHtml(blocks.image as Block)).toMatchInlineSnapshot(
      `"<div class="pg-image" data-block-id="image-studio-1" data-block-type="image"><a class="pg-image-link" href="/r/00000000-0000-4000-8000-0000000000b1/image-studio-1" rel="nofollow noopener"><img class="pg-image-img" src="https://media.test/page-media/6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/night-market-banner.webp" alt="The studio at golden hour" width="1200" height="480" loading="lazy" decoding="async" referrerPolicy="no-referrer"/></a></div>"`,
    );
  });

  it("a card with a banner image", () => {
    expect(blockHtml(blocks.card as Block)).toMatchInlineSnapshot(
      `"<a class="pg-card" data-block-id="card-night-mkt" data-block-type="card" href="/r/00000000-0000-4000-8000-0000000000b1/card-night-mkt" rel="nofollow noopener"><span class="pg-card-banner" data-has-image="true"><img class="pg-card-image" src="https://media.test/page-media/6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/night-market-banner.webp" alt="" width="1200" height="480" loading="lazy" decoding="async" referrerPolicy="no-referrer"/><span class="pg-card-title">Night Market</span></span><span class="pg-card-foot"><span class="pg-card-caption">View the gallery</span><span class="pg-card-arrow" aria-hidden="true">→</span></span></a>"`,
    );
  });

  it("a card without an image", () => {
    expect(blockHtml({ ...blocks.card, image: null } as Block)).toMatchInlineSnapshot(
      `"<a class="pg-card" data-block-id="card-night-mkt" data-block-type="card" href="/r/00000000-0000-4000-8000-0000000000b1/card-night-mkt" rel="nofollow noopener"><span class="pg-card-banner"><span class="pg-card-title">Night Market</span></span><span class="pg-card-foot"><span class="pg-card-caption">View the gallery</span><span class="pg-card-arrow" aria-hidden="true">→</span></span></a>"`,
    );
  });
});
