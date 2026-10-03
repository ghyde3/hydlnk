import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/document";
import {
  draftOf,
  makeOwner,
  publishedOf,
  rand,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag, revalidateTag: vi.fn(), unstable_cache: vi.fn() }));
const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M5-03, the Publish half, against the local Supabase with the secret key.
 *
 *   1. `checkBlocklist` on a stored draft: a domain listed AFTER the draft was saved is found, with
 *      the block that holds it. Always runs (it needs only the database).
 *   2. The gate itself: `publishPage` (the Server Action) refuses with `blocked_link`, leaves
 *      pages.published and published_at alone and never calls updateTag; after the link is removed
 *      Publish succeeds. Runs once src/lib/publish/core.ts calls `checkBlocklist` (the integration
 *      step wires it; see the reply of the blocklist agent), and is skipped before that.
 */
const { run } = await stackIsUp();

const link = (id: string, url: string): Block => ({
  id,
  type: "link",
  visible: true,
  label: "Link",
  url,
});

describe.skipIf(!run)("M5-03 Publish re-checks the blocklist (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];
  const domains: string[] = [];

  const listDomain = async (domain: string) => {
    const { error } = await admin.from("blocked_domains").insert({ domain, reason: "test" });
    expect(error).toBeNull();
    domains.push(domain);
  };
  const owner = async (label: string, blocks: Block[]) => {
    const made = await makeOwner(admin, label, (handle) => draftOf(handle, blocks));
    owners.push(made);
    return made;
  };
  const setLinks = async (o: TestOwner, blocks: Block[]) => {
    const { error } = await admin
      .from("pages")
      .update({ draft: draftOf("Alpha", blocks) as never })
      .eq("id", o.pageId);
    expect(error).toBeNull();
  };

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
  });
  afterAll(async () => {
    if (domains.length > 0) await admin.from("blocked_domains").delete().in("domain", domains);
    await removeOwners(admin, owners);
  });
  beforeEach(() => {
    updateTag.mockClear();
    getSessionUser.mockReset();
  });

  it("checkBlocklist finds a domain listed after the draft was saved, on the block that holds it", async () => {
    const { checkBlocklist } = await import("@/lib/blocklist");
    const late = `late-${rand(8)}.example`;
    const o = await owner("bg1", [
      link("lnk-aaaaaaaa", "https://ok.example"),
      link("lnk-bbbbbbbb", `https://www.${late}/x`),
    ]);
    const stored = async () =>
      (await admin.from("pages").select("draft").eq("id", o.pageId).single()).data!.draft;

    expect(await checkBlocklist(admin, await stored())).toEqual({
      links: [],
      hosts: [],
      errors: [],
    });
    await listDomain(late);
    const check = await checkBlocklist(admin, await stored());
    expect(check.hosts).toEqual([`www.${late}`]);
    expect(check.errors).toEqual([
      {
        blockId: "lnk-bbbbbbbb",
        field: "url",
        message: "That site is blocked. Use a different link.",
        host: `www.${late}`,
      },
    ]);

    await setLinks(o, [link("lnk-aaaaaaaa", "https://ok.example")]);
    expect((await checkBlocklist(admin, await stored())).errors).toEqual([]);
  });

  it("publishPage returns blocked_link for a domain listed after the draft was saved, changes nothing and never calls updateTag; after the link is removed Publish succeeds", async () => {
    const { publishPage } = await import("@/lib/publish/actions");
    const late = `gate-${rand(8)}.example`;
    const o = await owner("bg2", [link("lnk-aaaaaaaa", "https://ok.example")]);
    getSessionUser.mockResolvedValue({ id: o.userId, email: o.email });

    // A first, clean Publish, so there is something live to protect.
    expect((await publishPage(o.pageId)).ok).toBe(true);
    expect(updateTag).toHaveBeenCalledTimes(1);
    updateTag.mockClear();
    const before = await publishedOf(admin, o.pageId);
    expect(before.published_at).not.toBeNull();

    // The link goes in while the domain is not listed (autosave accepts it), then the domain is listed.
    await setLinks(o, [
      link("lnk-aaaaaaaa", "https://ok.example"),
      link("lnk-bbbbbbbb", `https://${late}/x`),
    ]);
    await listDomain(late);

    const result = await publishPage(o.pageId);
    expect(result).toMatchObject({ ok: false, reason: "blocked_link" });
    if (result.ok) throw new Error("unreachable");
    expect(result.errors).toEqual([
      {
        blockId: "lnk-bbbbbbbb",
        field: "url",
        message: "That site is blocked. Use a different link.",
        host: late,
      },
    ]);
    expect(await publishedOf(admin, o.pageId)).toEqual(before);
    expect(updateTag).not.toHaveBeenCalled();

    await setLinks(o, [link("lnk-aaaaaaaa", "https://ok.example")]);
    const fixed = await publishPage(o.pageId);
    expect(fixed.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect((await publishedOf(admin, o.pageId)).published_at).not.toBe(before.published_at);
  });
});
