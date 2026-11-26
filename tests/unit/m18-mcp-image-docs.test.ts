import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { listOwnedPostImageDocs } = await import("@/lib/mcp/page-access");

/**
 * M18-05: the image resolver reads the caller's post drafts for an `imageId` set in the post editor.
 * It selects the two image references of each draft only, never the whole draft (its body can be
 * 512 KiB, and a batch is many posts). A fake client records what is asked for.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TYPE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function fakeAdmin(rows: unknown[]) {
  const selects: Record<string, string[]> = {};
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const name of ["is", "eq", "in", "order", "not"]) chain[name] = self;
      chain.select = (columns: string) => {
        (selects[table] ??= []).push(columns);
        return chain;
      };
      const data =
        table === "content_types" ? [{ id: TYPE, site_id: SITE }] : (rows as unknown[]);
      chain.range = async () => ({ data, error: null });
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
      return chain;
    },
  };
  return { admin, selects };
}

describe("listOwnedPostImageDocs", () => {
  it("selects draft->featuredImage and draft->seo->ogImage, never the whole draft", async () => {
    const featured = { path: `${USER}/img-000000000001.webp`, width: 10, height: 10 };
    const og = { path: `${USER}/img-000000000002.webp`, width: 20, height: 20 };
    const { admin, selects } = fakeAdmin([
      {
        site_id: SITE,
        type_id: TYPE,
        featured_image: featured,
        og_image: og,
        site: { owner_id: USER },
      },
      { site_id: SITE, type_id: TYPE, featured_image: null, site: { owner_id: USER } },
    ]);
    const docs = await listOwnedPostImageDocs(admin as never, USER, 0, 50);
    const select = selects.content_entries!.join(" | ");
    expect(select).toContain("draft->featuredImage");
    expect(select).toContain("draft->seo->ogImage");
    // No bare draft column (and no published copy): only the two paths into it.
    for (const column of select.split(",").map((part) => part.trim())) {
      expect(column, select).not.toMatch(/^(draft|published|\*)$/);
      expect(column, select).not.toMatch(/^[a-z_]+:(draft|published)$/);
    }
    expect(select).not.toMatch(/->>?body|published/);
    expect(docs).toEqual([
      { draft: { featuredImage: featured, seo: { ogImage: og } } },
      { draft: { featuredImage: null, seo: { ogImage: null } } },
    ]);
  });
});
