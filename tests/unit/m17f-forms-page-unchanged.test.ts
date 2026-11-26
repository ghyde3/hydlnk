// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PublishDoc } from "@/lib/document";

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

const { renderLivePage, renderLiveSubPage } = await import("@/lib/tenant-render/live-page");
const { TENANT_SCRIPT_FILE, TENANT_SCRIPT_SRC } = await import("@/lib/tenant-assets");

/**
 * M17-04 steps 2 and 3, against what the pages were before this wave:
 *   * the tenant script is unchanged: its hashed name is the one before Wave D, and that is the
 *     one built file in public/_t;
 *   * a page without a form block is byte-identical to the pre-forms output, HTML and inline CSS:
 *     `fixtures/pre-forms-live-pages.json` was rendered by the base branch without the forms wave
 *     (origin/m17-blog at 9ff5c56, the same output as c779917) from the fixture document of the
 *     time, which holds no form; this renders the same inputs with today's code.
 */

/** The tenant script's name before Wave D (c779917 and origin/m17-blog). */
const PRE_FORMS_SCRIPT = "p.28f7e9af53f9.js";

describe("M17-04 a page without a form is what it was", () => {
  it("the tenant script's hashed name is unchanged and is the one built file", () => {
    expect(TENANT_SCRIPT_FILE).toBe(PRE_FORMS_SCRIPT);
    expect(TENANT_SCRIPT_SRC).toBe(`/_t/${PRE_FORMS_SCRIPT}`);
    const built = readdirSync(resolve(process.cwd(), "public/_t")).filter((name) =>
      /^p\.[0-9a-f]+\.js$/.test(name),
    );
    expect(built).toEqual([PRE_FORMS_SCRIPT]);
  });

  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/unit/fixtures/pre-forms-live-pages.json"), "utf8"),
  ) as {
    doc: PublishDoc;
    pageId: string;
    subPage: unknown;
    cases: Record<string, string>;
  };

  it("the fixture document holds no form block (so the comparison is about pages without one)", () => {
    expect(fixture.doc.blocks.some((block) => block.type === "form")).toBe(false);
    for (const html of Object.values(fixture.cases)) {
      expect(html).not.toContain("pg-form");
      // No form route (the fonts live under /_t/f/, which is not one).
      expect(html).not.toMatch(/["(]\/f\/[0-9a-f-]{36}/);
    }
  });

  it.each([
    [
      "home_free",
      () =>
        renderLivePage({ pageId: fixture.pageId, document: fixture.doc, plan: "free", urls: null }),
    ],
    [
      "home_pro",
      () =>
        renderLivePage({ pageId: fixture.pageId, document: fixture.doc, plan: "pro", urls: null }),
    ],
    [
      "home_urls",
      () =>
        renderLivePage({
          pageId: fixture.pageId,
          document: fixture.doc,
          plan: "free",
          urls: { page: "https://mara.hydlnk.com/", image: "https://mara.hydlnk.com/og" },
        } as never),
    ],
    [
      "sub_free",
      () =>
        renderLiveSubPage({
          pageId: fixture.pageId,
          subPageId: "00000000-0000-4000-8000-0000000000f5",
          document: fixture.doc,
          subPage: fixture.subPage,
          plan: "free",
          site: { hrefs: {} },
          urls: null,
        } as never),
    ],
  ] as const)("%s: byte-identical HTML and CSS to the pre-forms render", (name, render) => {
    const html = render();
    expect(html.length).toBe(fixture.cases[name]!.length);
    expect(html === fixture.cases[name]).toBe(true);
  });
});
