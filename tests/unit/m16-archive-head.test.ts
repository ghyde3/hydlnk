import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn() }));
vi.mock("@/app/(tenant)/published-page", () => ({ getTenantPageStateById: vi.fn() }));
vi.mock("@/lib/blog/published", () => ({}));
vi.mock("@/lib/site/published", () => ({}));

const { archiveMetadata } = await import("@/lib/tenant-render/archive-html");

/**
 * M16-05: an archive page's head carries a description (`pnpm lighthouse` fails the page's SEO
 * score without one): the site's bio when it has one, else a line made from the archive's name.
 */
const archive = {
  typeId: "t",
  key: "post",
  path: "blog",
  label: "Post",
  labelPlural: "Posts",
  pageSize: 10,
};
const page = (bio: string, name = "Mara") => ({ document: { profile: { name, bio } } }) as never;
const head = (bio: string, extra: Record<string, unknown> = {}, name = "Mara") =>
  archiveMetadata({
    page: page(bio, name),
    archive,
    term: null,
    pageNumber: 1,
    origin: "https://mara.hydlnk.com",
    siteImage: null,
    ...extra,
  } as never);

describe("M16-05 the archive's description", () => {
  it("is the site's bio, on the page and on its share card", () => {
    const meta = head("  Potter in Leeds.\nOpen Saturdays.  ");
    expect(meta.description).toBe("Potter in Leeds. Open Saturdays.");
    expect(meta.openGraph?.description).toBe(meta.description);
    expect(meta.twitter?.description).toBe(meta.description);
  });

  it("without a bio it names the archive and the site; a term and a page number are named too", () => {
    expect(head("").description).toBe("Posts from Mara.");
    expect(head("", {}, "").description).toBe("Posts.");
    const term = { taxonomy: "category", slug: "news", name: "News" };
    expect(head("", { term, pageNumber: 2 }).description).toBe("News · Page 2 from Mara.");
  });

  it("is there without an origin too (a site whose address cannot be built)", () => {
    expect(head("", { origin: null }).description).toBe("Posts from Mara.");
  });
});
