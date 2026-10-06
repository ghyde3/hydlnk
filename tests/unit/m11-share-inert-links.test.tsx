// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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

const { PageRenderer } = await import("@/components/page/page-renderer");

const SUB = "00000000-0000-4000-8000-0000000000a1";
const doc = {
  ...waveGPublished,
  blocks: [
    ...waveGPublished.blocks,
    {
      id: "pl-inert-0001",
      type: "page_link",
      visible: true,
      label: "See the items",
      target: SUB,
    },
  ],
} as typeof waveGPublished;
const site = { hrefs: { [SUB]: "/items" } };

function draw(extra: { inertLinks?: true } = {}) {
  const html = renderToStaticMarkup(
    <PageRenderer doc={doc} pageId={PAGE_ID} mode="preview" site={site} {...extra} />,
  );
  return new DOMParser().parseFromString(html, "text/html");
}

describe("M11-12 the private share preview draws page links as text", () => {
  it("without the flag a page link is an anchor to the site path (editor preview, live page)", () => {
    const link = draw().querySelector('[data-block-id="pl-inert-0001"]')!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/items");
  });

  it("with inertLinks it is the same box and label with no anchor and no href", () => {
    const document = draw({ inertLinks: true });
    const link = document.querySelector('[data-block-id="pl-inert-0001"]')!;
    expect(link.tagName).toBe("DIV");
    expect(link.textContent).toBe("See the items");
    expect(link.hasAttribute("href")).toBe(false);
    expect(link.getAttribute("data-block-type")).toBe("page_link");
    expect(document.querySelectorAll('a[href="/items"]').length).toBe(0);
  });

  it("the shared preview page no longer turns it on: its page links are real links inside the preview (M12-06)", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/(share)/app/shared-draft/page.tsx", "utf8");
    expect(page).not.toMatch(/<PageRenderer[\s\S]*?inertLinks[\s\S]*?\/>/);
    expect(page).toMatch(/subPage/);
  });
});
