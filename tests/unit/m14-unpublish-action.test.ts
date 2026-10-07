import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));

const revalidateTag = vi.fn();
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag, updateTag, unstable_cache: vi.fn() }));

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

const unpublishSiteCore = vi.fn();
vi.mock("@/lib/publish/unpublish", () => ({ unpublishSiteCore }));

const { unpublishSite } = await import("@/lib/publish/unpublish-action");

const PAGE = "00000000-0000-4000-8000-0000000000B1";
const USER = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

beforeEach(() => {
  revalidateTag.mockReset();
  updateTag.mockReset();
  getSessionUser.mockReset();
  unpublishSiteCore.mockReset();
});

describe("M14-02 unpublishSite (the Server Action)", () => {
  it("is a 'use server' module with one async export and no cache call of its own", () => {
    const text = readFileSync(join(process.cwd(), "src/lib/publish/unpublish-action.ts"), "utf8");
    expect(text.trimStart().startsWith('"use server"')).toBe(true);
    expect(text.match(/^export (?!type\b|interface\b)/gm)).toHaveLength(1);
    expect(text).toMatch(/^export async function unpublishSite\(pageId: string\)/m);
    expect(text).not.toMatch(/updateTag|revalidateTag|next\/cache/);
  });

  it("passes the session user, never a client-supplied owner, and expires the site's tag at once", async () => {
    getSessionUser.mockResolvedValue({ id: USER, email: "a@example.com" });
    unpublishSiteCore.mockResolvedValue({ ok: true, wasPublished: true });
    expect(await unpublishSite(PAGE)).toEqual({ ok: true, wasPublished: true });
    expect(unpublishSiteCore).toHaveBeenCalledWith({ pageId: PAGE, userId: USER });
    // Tags are case-sensitive: the id is lower-cased, as pages.id is stored; expiry is immediate.
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(`page:${PAGE.toLowerCase()}`, { expire: 0 });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("a signed-out caller reaches the core with no user and touches no cache", async () => {
    getSessionUser.mockResolvedValue(null);
    unpublishSiteCore.mockResolvedValue({ ok: false, reason: "unauthorized" });
    expect(await unpublishSite(PAGE)).toEqual({ ok: false, reason: "unauthorized" });
    expect(unpublishSiteCore).toHaveBeenCalledWith({ pageId: PAGE, userId: null });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  for (const reason of ["forbidden", "account_suspended", "error"] as const) {
    it(`a refusal (${reason}) expires nothing`, async () => {
      getSessionUser.mockResolvedValue({ id: USER, email: "a@example.com" });
      unpublishSiteCore.mockResolvedValue({ ok: false, reason });
      expect(await unpublishSite(PAGE)).toEqual({ ok: false, reason });
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(updateTag).not.toHaveBeenCalled();
    });
  }
});
