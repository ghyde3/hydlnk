// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockDefaults, publishedDocSchema, type Block, type FormBlock } from "@/lib/document";
import { resolveTokens } from "@/lib/theme";
import { makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";

vi.mock("server-only", () => ({}));

/**
 * The data cache as a map: an entry is stored when the cached function RESOLVES (a throw stores
 * nothing, as Next's data cache does). `keys()` lists what a run left behind.
 */
const cache = vi.hoisted(() => {
  const entries = new Map<string, unknown>();
  return {
    entries,
    unstable_cache:
      (fn: (...args: unknown[]) => Promise<unknown>, key: string[]) =>
      async (...args: unknown[]) => {
        const id = key.join("|");
        if (entries.has(id)) return entries.get(id);
        const value = await fn(...args);
        entries.set(id, value);
        return value;
      },
  };
});
vi.mock("next/cache", () => ({ unstable_cache: cache.unstable_cache }));

/**
 * M17-06 step 2 and M17-05 step 1, `resolveFormBlock` itself against the local stack: only a VISIBLE
 * form block of a PUBLISHED document of a site whose owner is not suspended is a target (with the
 * owner's plan); another block type, a hidden form, a draft-only form, an unpublished site and a
 * suspended owner are null. On a production build (NODE_ENV=production, the data cache in play) an
 * invented page id asked through the form path leaves no cache entry, while the click path still
 * stores its miss (pre-existing, reported, not changed here).
 */
const { run } = await stackIsUp();

const FORM: FormBlock = { ...(blockDefaults.form() as FormBlock), id: "formResolve1" };
const HIDDEN: FormBlock = { ...FORM, id: "formHidden01", visible: false };
const DRAFT_ONLY: FormBlock = { ...FORM, id: "formDraft001" };
const LINK = {
  id: "lnkResolve01",
  type: "link",
  visible: true,
  label: "Shop",
  url: "https://example.com/shop",
} as const;

function publishDoc(blocks: Block[]) {
  return publishedDocSchema.parse({
    version: 1,
    profile: { name: "Resolve", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: resolveTokens(null),
    blocks,
  });
}

describe.skipIf(!run)("M17-06 resolveFormBlock (local Supabase)", () => {
  let admin: SupabaseClient;
  let resolveFormBlock: typeof import("@/lib/analytics/ingest/pages").resolveFormBlock;
  let resolveClickTarget: typeof import("@/lib/analytics/ingest/pages").resolveClickTarget;
  let lookupBeaconPage: typeof import("@/lib/analytics/ingest/pages").lookupBeaconPage;
  const owners: TestOwner[] = [];

  async function site(
    label: string,
    opts: { published?: boolean; plan?: "free" | "pro"; suspended?: boolean } = {},
  ): Promise<TestOwner> {
    const owner = await makeOwner(
      admin,
      label,
      (handle) => ({
        version: 1,
        rev: 1,
        profile: { name: handle, bio: "", photo: null },
        theme: { ref: null, overrides: {} },
        blocks: [LINK, FORM, HIDDEN, DRAFT_ONLY],
      }),
      opts.plan ?? "free",
    );
    owners.push(owner);
    await moveHome(admin, owner.pageId);
    if (opts.published !== false) {
      // As Publish writes it: the site row and Home's entry in one publish_site call.
      const { error } = await admin.rpc("publish_site", {
        p_page_id: owner.pageId,
        p_owner_id: owner.userId,
        p_home: publishDoc([LINK, FORM, HIDDEN] as Block[]) as never,
        p_sub_pages: [] as never,
        p_published_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    }
    if (opts.suspended) {
      const { error } = await admin
        .from("accounts")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", owner.userId);
      if (error) throw new Error(error.message);
    }
    return owner;
  }

  beforeAll(async () => {
    admin = adminClient();
    ({ resolveFormBlock, resolveClickTarget, lookupBeaconPage } =
      await import("@/lib/analytics/ingest/pages"));
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await removeOwners(admin, owners);
  });

  it("a visible form block of the published document is the target, with the handle and the plan", async () => {
    const free = await site("fres-a");
    const target = await resolveFormBlock(free.pageId, FORM.id);
    expect(target).toMatchObject({
      block: { id: FORM.id, type: "form" },
      handle: free.handle,
      plan: "free",
    });
    expect(target!.subPageId).toBeUndefined();
    const pro = await site("fres-p", { plan: "pro" });
    expect((await resolveFormBlock(pro.pageId, FORM.id))!.plan).toBe("pro");
  });

  it("another block type, a hidden form, a draft-only form and an unknown id are null", async () => {
    const owner = await site("fres-b");
    expect(await resolveFormBlock(owner.pageId, LINK.id)).toBeNull();
    expect(await resolveFormBlock(owner.pageId, HIDDEN.id)).toBeNull();
    expect(await resolveFormBlock(owner.pageId, DRAFT_ONLY.id)).toBeNull();
    expect(await resolveFormBlock(owner.pageId, "formNoSuch01")).toBeNull();
  });

  it("an unpublished site and a suspended owner are null", async () => {
    const draftOnly = await site("fres-c", { published: false });
    expect(await resolveFormBlock(draftOnly.pageId, FORM.id)).toBeNull();
    const suspended = await site("fres-d", { suspended: true });
    expect(await resolveFormBlock(suspended.pageId, FORM.id)).toBeNull();
  });

  it("on a production build an invented page id through /f stores no cache entry; /r still stores its miss", async () => {
    vi.stubEnv("NODE_ENV", "production");
    cache.entries.clear();
    const invented = () => crypto.randomUUID();
    for (let i = 0; i < 50; i++) {
      expect(await resolveFormBlock(invented(), "formInvent01")).toBeNull();
      expect(await lookupBeaconPage(invented(), { cacheMisses: false })).toBeNull();
    }
    expect([...cache.entries.keys()]).toEqual([]);

    // A real site through /f is cached like any read (bounded: one core entry per real site).
    const owner = await site("fres-e");
    expect(await resolveFormBlock(owner.pageId, FORM.id)).not.toBeNull();
    expect([...cache.entries.keys()].some((key) => key.includes(owner.pageId))).toBe(true);

    // Pre-existing, out of scope: the click path stores a miss for each invented page id.
    const before = cache.entries.size;
    await resolveClickTarget(invented(), "lnkInvented1");
    expect(cache.entries.size).toBe(before + 1);
    vi.unstubAllEnvs();
  }, 60_000);
});
