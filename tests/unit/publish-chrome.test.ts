// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import { pageChrome, reportUrl, showBadge } from "@/lib/publish/chrome";
import { blocks, fullPublished, noirTokens } from "./fixtures/page-document";

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

const empty: PublishDoc = {
  version: 1,
  profile: { name: "Mara Okafor", bio: "", photo: null },
  theme: { ref: null, overrides: {} },
  tokens: noirTokens,
  blocks: [],
};

function render(doc: PublishDoc, plan: string | null | undefined, pageId = PAGE_ID): Document {
  const html = renderToStaticMarkup(
    createElement(PageRenderer, { doc, pageId, mode: "live", chrome: pageChrome(plan, pageId) }),
  );
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

const badge = (dom: Document) =>
  Array.from(dom.querySelectorAll("a")).filter((a) => a.textContent === "Made with HYDLNK");
const report = (dom: Document) =>
  Array.from(dom.querySelectorAll("a")).filter((a) => a.textContent === "Report this page");

describe("M2-28 the badge shows on every plan but pro and studio", () => {
  it.each([
    ["free", true],
    ["pro", false],
    ["studio", false],
    // Fails closed: anything that is not a paid plan shows the badge.
    ["enterprise", true],
    ["", true],
    ["PRO", true],
    [" pro", true],
    [null, true],
    [undefined, true],
  ])("plan %j shows the badge: %s", (plan, shown) => {
    expect(showBadge(plan)).toBe(shown);
    const dom = render(fullPublished, plan);
    expect(badge(dom)).toHaveLength(shown ? 1 : 0);
  });

  it("the badge points at the HYDLNK marketing origin with rel=noopener", () => {
    const [link] = badge(render(fullPublished, "free"));
    expect(link!.getAttribute("href")).toBe("http://localhost:3000");
    expect(link!.getAttribute("rel")).toBe("noopener");
  });

  it("the decision never reads the document: a draft or published key cannot remove it", () => {
    const hostile = {
      ...fullPublished,
      badge: false,
      settings: { hideBadge: true, hideReport: true },
      profile: { ...fullPublished.profile, badge: false },
    } as unknown as PublishDoc;
    const dom = render(hostile, "free");
    expect(badge(dom)).toHaveLength(1);
    expect(report(dom)).toHaveLength(1);
  });
});

describe("M2-29 the report link is on every public page", () => {
  it("builds the HYDLNK origin plus /report?page={pageId}", () => {
    expect(reportUrl(PAGE_ID)).toBe(`http://localhost:3000/report?page=${PAGE_ID}`);
    expect(reportUrl(PAGE_ID, "hydlnk.com")).toBe(`https://hydlnk.com/report?page=${PAGE_ID}`);
  });

  it("is present on a page with zero blocks, on a Pro page with no badge, and for a free page", () => {
    for (const plan of ["free", "pro", "studio"]) {
      const dom = render(empty, plan);
      expect(dom.querySelectorAll("[data-block-id]")).toHaveLength(0);
      const links = report(dom);
      expect(links, plan).toHaveLength(1);
      expect(links[0]!.getAttribute("href")).toBe(`http://localhost:3000/report?page=${PAGE_ID}`);
    }
    expect(badge(render(empty, "pro"))).toHaveLength(0);
  });

  it("the href carries only the page id: a hostile handle, name or bio never reaches it", () => {
    const hostile: PublishDoc = {
      ...empty,
      profile: {
        name: '"><script>alert(1)</script> & handle=evil',
        bio: "javascript:alert(1)",
        photo: null,
      },
      blocks: [blocks.link, blocks.header],
    };
    const dom = render(hostile, "free");
    const [link] = report(dom);
    expect(link!.getAttribute("href")).toBe(`http://localhost:3000/report?page=${PAGE_ID}`);
    expect(link!.textContent).toBe("Report this page");
    const url = new URL(link!.getAttribute("href")!);
    expect([...url.searchParams.keys()]).toEqual(["page"]);
    expect(link!.getAttribute("href")).not.toMatch(/script|evil|handle|javascript/);
  });

  it("encodes whatever is passed as the id, so the query keeps its shape", () => {
    const url = reportUrl("a&b=c#d");
    expect(url).toBe("http://localhost:3000/report?page=a%26b%3Dc%23d");
    expect([...new URL(url).searchParams.entries()]).toEqual([["page", "a&b=c#d"]]);
  });

  it("the footer is not a block: no block id", () => {
    const dom = render(empty, "free");
    const footer = dom.querySelector("[data-page-footer]")!;
    expect(footer.hasAttribute("data-block-id")).toBe(false);
    expect(footer.querySelector("[data-block-id]")).toBeNull();
  });
});
