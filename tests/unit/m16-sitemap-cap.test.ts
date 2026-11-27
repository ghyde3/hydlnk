import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
vi.mock("@/app/(tenant)/published-page", () => ({
  getTenantSiteState: vi.fn(),
  getTenantPageStateById: vi.fn(),
}));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn() }));
vi.mock("@/lib/routing/custom-domain", () => ({
  lookupKey: vi.fn(),
  resolveCustomDomain: vi.fn(),
}));
vi.mock("@/lib/site/published", () => ({ getSiteIndex: async () => [{ path: "about" }] }));

const SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TYPE = "10000000-0000-4000-8000-000000000002";
const TOTAL = 6200;

/** A Postgres that holds 6,200 live posts, newest first (post-1 is the newest), answering `range`. */
function stubClient() {
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    live_slug: `post-${i + 1}`,
    first_published_at: new Date(Date.UTC(2026, 10, 20) - i * 60_000).toISOString(),
    published_at: null,
    title: `Post ${i + 1}`,
    // Every 100th post is noindex.
    noindex: i % 100 === 0,
  }));
  const typeRows = {
    data: [{ id: TYPE, key: "post", label: "Post", label_plural: "Posts", archive_path: "blog" }],
    error: null,
  };
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "not", "order", "filter"]) q[m] = () => q;
    q.range = async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
      count: TOTAL,
    });
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve(table === "content_types" ? typeRows : { data: [], error: null });
    return q;
  };
  return { from: (table: string) => chain(table) };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => stubClient() }));

describe("the sitemap's post cap (M16-06)", () => {
  it("lists only the newest 5,000 posts of a type, leaving out noindex ones", async () => {
    const { sitePaths } = await import("@/lib/tenant-render/sitemap");
    const paths = await sitePaths(SITE);
    const posts = paths.filter((p) => /^blog\/post-\d+$/.test(p));
    // The newest 5,000 are post-1..post-5000; 50 of them (every 100th, i % 100 === 0) are noindex.
    expect(posts).toHaveLength(5000 - 50);
    expect(paths).toContain("about");
    expect(paths).toContain("blog");
    expect(paths).toContain("blog/post-5000");
    expect(paths).not.toContain("blog/post-5001");
    expect(paths).not.toContain("blog/post-6200");
    expect(paths).not.toContain("blog/post-1");
    expect(paths).toContain("blog/post-2");
  });
});
