// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const next = vi.hoisted(() => ({ revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => next);
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

import { invalidateEntry, invalidatePage, invalidateType } from "@/lib/publish/invalidate";
import { entryTag, handleTag, pageTag, typeTag } from "@/lib/publish/tags";

/**
 * M16-09: the three tags and what the invalidation module expires for each write. A post expires
 * its own entry and its type and never the whole site (so publishing post B leaves post A's HTML in
 * the cache); a type that is switched or moved expires the type and the site (the archive list and
 * the menu live under the site tag). Always `{ expire: 0 }`: nothing stale is served, and never
 * `updateTag`, because the writer runs in Route Handlers too.
 */
const SITE = "11111111-1111-4111-8111-111111111111";
const TYPE = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";

const expired = () => next.revalidateTag.mock.calls.map(([tag]) => tag as string).sort();

describe("M16-09 cache tags per entry, type and site", () => {
  beforeEach(() => {
    next.revalidateTag.mockReset();
    next.updateTag.mockReset();
  });

  it("names the three tags apart, each from an id that never changes", () => {
    expect(pageTag(SITE)).toBe(`page:${SITE}`);
    expect(entryTag(ENTRY)).toBe(`entry:${ENTRY}`);
    expect(typeTag(TYPE)).toBe(`type:${TYPE}`);
    // The same id under two kinds never collides, and no tag passes for a handle's.
    const same = [pageTag(SITE), entryTag(SITE), typeTag(SITE), handleTag(SITE)];
    expect(new Set(same).size).toBe(4);
  });

  it("invalidateEntry expires exactly the entry and its type, at once, not the site", () => {
    invalidateEntry({ siteId: SITE, typeId: TYPE, typeKey: "post", entryId: ENTRY });
    expect(expired()).toEqual([`entry:${ENTRY}`, `type:${TYPE}`]);
    for (const call of next.revalidateTag.mock.calls) expect(call[1]).toEqual({ expire: 0 });
    expect(next.updateTag).not.toHaveBeenCalled();
  });

  it("invalidateEntry expires the type even when the entry tag throws, then raises", () => {
    next.revalidateTag.mockImplementationOnce(() => {
      throw new Error("cache down");
    });
    expect(() =>
      invalidateEntry({ siteId: SITE, typeId: TYPE, typeKey: "post", entryId: ENTRY }),
    ).toThrow("cache down");
    expect(expired()).toEqual([`entry:${ENTRY}`, `type:${TYPE}`]);
  });

  it("invalidateType expires exactly the type and the site", () => {
    invalidateType({ siteId: SITE, typeId: TYPE });
    expect(expired()).toEqual([`page:${SITE}`, `type:${TYPE}`]);
    for (const call of next.revalidateTag.mock.calls) expect(call[1]).toEqual({ expire: 0 });
    expect(next.updateTag).not.toHaveBeenCalled();
  });

  it("invalidatePage (Publish design, a domain change) expires the site tag alone", () => {
    invalidatePage(SITE);
    expect(expired()).toEqual([`page:${SITE}`]);
  });
});
