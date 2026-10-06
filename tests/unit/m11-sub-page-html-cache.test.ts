import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: {
  fn: unknown;
  keyParts: string[];
  options: Record<string, unknown>;
  args: unknown[];
}[] = [];
const unstable_cache = vi.fn(
  (fn: unknown, keyParts: string[], options: Record<string, unknown>) =>
    async (...args: unknown[]) => {
      calls.push({ fn, keyParts, options, args });
      return "<html>cached</html>";
    },
);
vi.mock("next/cache", () => ({ unstable_cache }));
vi.mock("@/app/(tenant)/published-page", () => ({ getTenantPageStateById: vi.fn() }));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn() }));
vi.mock("@/lib/site/published", () => ({ getSiteIndex: vi.fn(), getPublishedSubPage: vi.fn() }));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));

const { getSubPageHtml, subPageHtmlKey, subPageHtmlOptions, renderSubPageHtml } =
  await import("@/lib/tenant-render/sub-page-html");
const { PUBLIC_READ_CACHE_VERSION } = await import("@/lib/publish/tags");

const SITE = "00000000-0000-4000-8000-0000000000b1";
const SUB = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  calls.length = 0;
  unstable_cache.mockClear();
  vi.unstubAllEnvs();
});

describe("M11-12 the finished HTML of a real sub-page is cached", () => {
  it("the key carries the REAL sub-page id and the public-read version, the tag is the site's page:<id>", () => {
    expect(subPageHtmlKey(SUB)).toEqual(["tenant-sub-page-html", PUBLIC_READ_CACHE_VERSION, SUB]);
    expect(subPageHtmlOptions(SITE)).toMatchObject({ tags: [`page:${SITE}`] });
  });

  it("in production it goes through unstable_cache with that key, that tag and the real ids as arguments", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const html = await getSubPageHtml(SITE, SUB, "items", "mara");
    expect(html).toBe("<html>cached</html>");
    expect(unstable_cache).toHaveBeenCalledTimes(1);
    expect(calls[0]!.fn).toBe(renderSubPageHtml);
    expect(calls[0]!.keyParts).toEqual(["tenant-sub-page-html", PUBLIC_READ_CACHE_VERSION, SUB]);
    expect(calls[0]!.options).toMatchObject({ tags: [`page:${SITE}`] });
    expect(calls[0]!.args).toEqual([SITE, SUB, "items", "mara"]);
  });

  it("outside production nothing is cached (next dev renders every time)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { getTenantPageStateById } = await import("@/app/(tenant)/published-page");
    vi.mocked(getTenantPageStateById).mockResolvedValue({ kind: "missing" } as never);
    expect(await getSubPageHtml(SITE, SUB, "items", null)).toBeNull();
    expect(unstable_cache).not.toHaveBeenCalled();
  });
});

describe("M11-12 the route asks for the cached HTML only after the site index named the page", () => {
  it("respond.ts calls getSubPageHtml with entry.id (the index's id), never with the path alone", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync("src/lib/tenant-render/respond.ts", "utf8");
    expect(text).toMatch(/getSubPageHtml\(page\.pageId, entry\.id, entry\.path, handle\)/);
    expect(text.indexOf("if (!entry) return plainNotFoundResponse()")).toBeLessThan(
      text.indexOf("getSubPageHtml(page.pageId"),
    );
    // The routes stay dynamic: no entry is stored per invented path.
    const route = readFileSync("src/app/(tenant)/t/[handle]/p/[path]/route.ts", "utf8");
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
  });
});
