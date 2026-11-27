import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp } from "./publish-support";
import { adminClient, publishableClient, signIn } from "./m17f-forms-db-support";
import { fixtureUsers, teamFixture, tokenHash, type TeamFixture } from "./m19t-team-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-04 (T1, T3, T5, T6, T17): the publishable-key probe over PostgREST, the path curl takes. With
 * owner O, editor E and publisher P of S, stranger X, anon, and O's second site S2:
 *   * X and anon read and write nothing of S;
 *   * E and P read S and write only pages.draft of S (never name, handle or S2);
 *   * nobody but service_role touches the team tables or functions;
 *   * after E's row is deleted, the same client with the same access token reads and writes nothing.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M19-04 the publishable-key probe (local Supabase)", () => {
  let admin: SupabaseClient;
  let f: TeamFixture;
  let asE: SupabaseClient;
  let asP: SupabaseClient;
  let asX: SupabaseClient;
  let anon: SupabaseClient;

  beforeAll(async () => {
    admin = adminClient();
    f = await teamFixture(admin, "m19probe");
    [asE, asP, asX] = await Promise.all([signIn(admin, f.editor), signIn(admin, f.publisher), signIn(admin, f.stranger)]);
    anon = publishableClient();
  });

  afterAll(async () => {
    if (f) await removeOwners(admin, fixtureUsers(f));
  });

  const reads = async (client: SupabaseClient, siteId: string) => {
    const [page, types, entries, paths] = await Promise.all([
      client.from("pages").select("id, draft").eq("id", siteId),
      client.from("content_types").select("id").eq("site_id", siteId),
      client.from("content_entries").select("id").eq("site_id", siteId),
      client.from("site_paths").select("site_id").eq("site_id", siteId),
    ]);
    return {
      pages: page.data?.length ?? 0,
      types: types.data?.length ?? 0,
      entries: entries.data?.length ?? 0,
      paths: paths.data?.length ?? 0,
    };
  };
  const writeDraft = async (client: SupabaseClient, siteId: string, bio: string) => {
    const current = await admin.from("pages").select("draft").eq("id", siteId).single();
    const draft = { ...(current.data!.draft as Record<string, unknown>), profile: { name: "S", bio, photo: null } };
    const res = await client.from("pages").update({ draft }).eq("id", siteId).select("id");
    return { error: res.error, rows: res.data?.length ?? 0 };
  };

  it("M19-04 the stranger and anon read nothing of S and update nothing", async () => {
    for (const client of [asX, anon]) {
      expect(await reads(client, f.owner.pageId)).toEqual({ pages: 0, types: 0, entries: 0, paths: 0 });
      expect((await writeDraft(client, f.owner.pageId, "x")).rows).toBe(0);
    }
  });

  it("M19-04 the editor and the publisher read S, write only its draft, and read nothing of S2", async () => {
    for (const [client, bio] of [[asE, "by editor"], [asP, "by publisher"]] as const) {
      const r = await reads(client, f.owner.pageId);
      expect(r.pages).toBe(1);
      expect(r.types).toBeGreaterThan(0);
      expect(await writeDraft(client, f.owner.pageId, bio)).toEqual({ error: null, rows: 1 });
      const renamed = await client.from("pages").update({ name: "Mine" }).eq("id", f.owner.pageId).select("id");
      expect(renamed.error?.code).toBe("42501");
      const handle = await client.from("pages").update({ handle: "zq-taken" } as never).eq("id", f.owner.pageId);
      expect(handle.error?.code).toBe("42501");
      expect(await reads(client, f.s2)).toEqual({ pages: 0, types: 0, entries: 0, paths: 0 });
      expect((await writeDraft(client, f.s2, bio)).rows).toBe(0);
      // Own-account reads stay own: the owner's account row is not readable.
      const account = await client.from("accounts").select("id").eq("id", f.owner.userId);
      expect(account.data ?? []).toEqual([]);
    }
    const saved = await admin.from("pages").select("draft, name").eq("id", f.owner.pageId).single();
    expect((saved.data!.draft as { profile: { bio: string } }).profile.bio).toBe("by publisher");
    expect(saved.data!.name).not.toBe("Mine");
  });

  it("M19-04 nobody but service_role reaches the team tables or the access functions", async () => {
    for (const client of [asE, asP, asX, anon]) {
      for (const table of ["site_members", "site_invites", "site_activity"]) {
        const res = await client.schema("team" as never).from(table).select("*");
        expect(res.data ?? null, table).toBeNull();
        expect(res.error, table).not.toBeNull();
      }
      for (const [fn, args] of [
        ["site_access", { p_site: f.owner.pageId, p_user: f.owner.userId }],
        ["require_site_access", { p_site: f.owner.pageId, p_user: f.owner.userId, p_need: "owner" }],
        ["list_shared_sites", { p_user: f.editor.userId }],
        ["set_site_member_role", { p_site: f.owner.pageId, p_actor: f.owner.userId, p_user: f.editor.userId, p_role: "publisher" }],
        ["create_site_invite", { p_site: f.owner.pageId, p_actor: f.owner.userId, p_email: "z@example.com", p_token_hash: tokenHash("z"), p_role: "publisher" }],
        ["accept_site_invite", { p_token_hash: tokenHash("z"), p_user: f.stranger.userId, p_methods: ["otp"] }],
      ] as const) {
        const res = await client.rpc(fn as never, args as never);
        expect(res.error, fn).not.toBeNull();
      }
      const projection = await client.schema("access" as never).rpc("accessible_site_ids" as never, { p_need: "read" } as never);
      expect(projection.error).not.toBeNull();
    }
    const role = await admin.rpc("site_access", { p_site: f.owner.pageId, p_user: f.editor.userId });
    expect((role.data as { role: string }[])[0]!.role).toBe("editor");
  });

  it("M19-04 after the editor's row is deleted, the same client and token read and write nothing", async () => {
    const before = await reads(asE, f.owner.pageId);
    expect(before.pages).toBe(1);
    const removed = await admin.rpc("remove_site_member", {
      p_site: f.owner.pageId,
      p_actor: f.owner.userId,
      p_user: f.editor.userId,
    });
    expect(removed.error).toBeNull();
    expect(await reads(asE, f.owner.pageId)).toEqual({ pages: 0, types: 0, entries: 0, paths: 0 });
    expect((await writeDraft(asE, f.owner.pageId, "after removal")).rows).toBe(0);
    const saved = await admin.from("pages").select("draft").eq("id", f.owner.pageId).single();
    expect((saved.data!.draft as { profile: { bio: string } }).profile.bio).not.toBe("after removal");
  });
});
