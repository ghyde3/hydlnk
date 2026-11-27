import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp } from "./publish-support";
import { adminClient, publishableClient, signIn } from "./m17f-forms-db-support";
import { fixtureUsers, teamFixture, tokenHash, type TeamFixture } from "./m19t-team-support";
import { enablePost } from "./content-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-04 (T1, T3, T5, T6, T17): the publishable-key probe over PostgREST, the path curl takes. With
 * owner O, editor E and publisher P of S, stranger X, anon, and O's second site S2:
 *   * X and anon read and write nothing of S;
 *   * E and P read S and write only pages.draft of S (never name, handle, published, published_at
 *     or S2); of S's revisions, terms, entry terms, versions, old slugs and schedules and O's saved
 *     themes they read exactly what the site access policies open (S's rows, O's themes), and X,
 *     anon and the removed E read none of them;
 *   * X, anon, E and P insert, update and delete nothing in S's entries, terms, paths and versions
 *     or O's saved themes (each probe touches no row, and the rows are unchanged afterwards);
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

  /** Set by the steps 2, 3 probe: every write probe as `client`, touching nothing (also step 5's). */
  let writeProbe: ((who: string, client: SupabaseClient) => Promise<void>) | null = null;
  /** Set by the steps 2, 3 probe: `client` reads no row of the member-readable tables (also step 5's). */
  let readProbe: ((who: string, client: SupabaseClient) => Promise<void>) | null = null;

  it("M19-04 steps 2, 3: E and P read exactly S's revisions, terms, versions, old slugs, schedules and O's themes, X and anon none; nobody but O writes them or S's live copy", async () => {
    const S = f.owner.pageId;
    await enablePost(admin as never, S);
    const postType = (await admin.from("content_types").select("id").eq("site_id", S).eq("key", "post").single()).data!.id as string;
    const post = await admin.from("content_entries").insert({ site_id: S, type_id: postType, draft: { title: "Probe", slug: "probe" } }).select("id").single();
    expect(post.error).toBeNull();
    const term = await admin.from("content_terms").insert({ site_id: S, type_id: postType, taxonomy: "tag", slug: "probe-tag", name: "Probe tag" }).select("id").single();
    expect(term.error).toBeNull();
    // page_versions is written only by the publish trigger: a publish of S (a Studio site) records one.
    const published = await admin.from("pages").update({ published: { version: 1, blocks: [] } as never, published_at: new Date().toISOString() }).eq("id", S);
    expect(published.error).toBeNull();
    const version = await admin.from("page_versions").select("id").eq("page_id", S).order("version_no", { ascending: false }).limit(1).single();
    expect(version.error).toBeNull();
    const tokens = (await admin.from("themes").select("tokens").is("owner_id", null).limit(1).single()).data!.tokens;
    const theme = await admin.from("themes").insert({ owner_id: f.owner.userId, name: "Owner's probe theme", tokens }).select("id").single();
    expect(theme.error).toBeNull();
    const paths = await admin.from("site_paths").select("path").eq("site_id", S);
    expect(paths.data!.length).toBeGreaterThan(0);
    // A row in each of the other site-scoped tables the members' policies open (the site access
    // policies migration, 20261126220200): a revision, an entry's term, an old slug and a schedule.
    // An old slug is written only by its trigger: a published post whose slug changes leaves one.
    for (const slug of ["old-probe", "probe"]) {
      const live = await admin
        .from("content_entries")
        .update({ published: { title: "Probe", slug }, published_at: new Date().toISOString() })
        .eq("id", post.data!.id);
      expect(live.error).toBeNull();
    }
    const seeded = await Promise.all([
      admin.from("content_entry_revisions").insert({ entry_id: post.data!.id, site_id: S, rev: 1, snapshot: { title: "Probe" }, source: "editor" }),
      admin.from("content_entry_terms").insert({ entry_id: post.data!.id, term_id: term.data!.id }),
      admin.from("content_schedules").insert({
        site_id: S,
        entry_id: post.data!.id,
        action: "unpublish",
        run_at: new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 86_400_000).toISOString(),
        source: "editor",
        created_by: f.owner.userId,
      }),
    ]);
    for (const res of seeded) expect(res.error).toBeNull();
    // S2 (no member) gets an entry, a revision and a published version, so "nothing of S2" is a real read.
    await enablePost(admin as never, f.s2);
    const s2Type = (await admin.from("content_types").select("id").eq("site_id", f.s2).eq("key", "post").single()).data!.id as string;
    const s2Post = await admin.from("content_entries").insert({ site_id: f.s2, type_id: s2Type, draft: { title: "S2", slug: "s2" } }).select("id").single();
    expect(s2Post.error).toBeNull();
    const s2Seeded = await Promise.all([
      admin.from("content_entry_revisions").insert({ entry_id: s2Post.data!.id, site_id: f.s2, rev: 1, snapshot: { title: "S2" }, source: "editor" }),
      admin.from("pages").update({ published: { version: 1, blocks: [] } as never, published_at: new Date().toISOString() }).eq("id", f.s2),
    ]);
    for (const res of s2Seeded) expect(res.error).toBeNull();

    /**
     * Every row of these tables `client` can read, unfiltered (so a row of S2 or of another owner
     * would show), sorted. Members may read S's rows and the owner's saved themes, nothing more.
     */
    const READABLE = [
      ["content_entry_revisions", "id, site_id"],
      ["content_terms", "id, site_id"],
      ["content_entry_terms", "entry_id, term_id"],
      ["page_versions", "id, page_id"],
      ["content_slug_redirects", "type_id, from_slug, site_id"],
      ["content_schedules", "id, site_id"],
    ] as const;
    const sorted = (rows: unknown[] | null) => (rows ?? []).map((row) => JSON.stringify(row)).sort();
    const readable = async (client: SupabaseClient) => {
      const out: Record<string, string[]> = {};
      for (const [table, columns] of READABLE) {
        const res = await client.from(table).select(columns);
        out[table] = res.error ? [] : sorted(res.data);
      }
      const themes = await client.from("themes").select("id, owner_id").not("owner_id", "is", null);
      out["owner's themes"] = themes.error ? [] : sorted(themes.data);
      return out;
    };
    const entryIds = (await admin.from("content_entries").select("id").eq("site_id", S)).data!.map((row) => row.id as string);
    const membersRead: Record<string, string[]> = {};
    for (const [table, columns] of READABLE) {
      const scoped =
        table === "content_entry_terms"
          ? admin.from(table).select(columns).in("entry_id", entryIds)
          : admin.from(table).select(columns).eq(table === "page_versions" ? "page_id" : "site_id", S);
      membersRead[table] = sorted((await scoped).data);
    }
    membersRead["owner's themes"] = sorted((await admin.from("themes").select("id, owner_id").eq("owner_id", f.owner.userId)).data);
    for (const [table, rows] of Object.entries(membersRead)) expect(rows.length, table).toBeGreaterThan(0);
    const nothing = Object.fromEntries(Object.keys(membersRead).map((table) => [table, []]));

    for (const [who, client] of [["editor", asE], ["publisher", asP]] as const) {
      expect(await readable(client), who).toEqual(membersRead);
    }
    readProbe = async (who, client) => {
      expect(await readable(client), who).toEqual(nothing);
    };
    for (const [who, client] of [["stranger", asX], ["anon", anon]] as const) await readProbe(who, client);

    const snapshot = async () => {
      const [entries, terms, sitePaths, versions, themes, live] = await Promise.all([
        admin.from("content_entries").select("id, rev, draft, deleted_at, published").eq("site_id", S).order("id"),
        admin.from("content_terms").select("id, name, slug").eq("site_id", S).order("id"),
        admin.from("site_paths").select("path, entry_id, type_id").eq("site_id", S).order("path"),
        admin.from("page_versions").select("id, version_no, document").eq("page_id", S).order("id"),
        admin.from("themes").select("id, name, tokens").eq("owner_id", f.owner.userId).order("id"),
        admin.from("pages").select("published, published_at").eq("id", S).single(),
      ]);
      return { entries: entries.data, terms: terms.data, sitePaths: sitePaths.data, versions: versions.data, themes: themes.data, live: live.data };
    };
    const before = await snapshot();
    expect(before.entries!.length).toBeGreaterThan(0);
    expect(before.versions).toHaveLength(1);
    expect(before.live!.published).not.toBeNull();
    expect(before.live!.published_at).not.toBeNull();
    /** Rows a write touched: an error (no grant, a policy) touches none. */
    const touched = (res: { error: unknown; data: unknown[] | null }) => (res.error ? 0 : (res.data?.length ?? 0));

    writeProbe = async (who, client) => {
      const probes: Record<string, { error: unknown; data: unknown[] | null }> = {
        "entries insert": await client.from("content_entries").insert({ site_id: S, type_id: postType, draft: { title: "Planted" } }).select("id"),
        "entries update": await client.from("content_entries").update({ draft: { title: "Taken over" } }).eq("id", post.data!.id).select("id"),
        "entries delete": await client.from("content_entries").delete().eq("id", post.data!.id).select("id"),
        "terms insert": await client.from("content_terms").insert({ site_id: S, type_id: postType, taxonomy: "tag", slug: "planted", name: "Planted" }).select("id"),
        "terms update": await client.from("content_terms").update({ name: "Taken over" }).eq("id", term.data!.id).select("id"),
        "terms delete": await client.from("content_terms").delete().eq("id", term.data!.id).select("id"),
        "paths insert": await client.from("site_paths").insert({ site_id: S, path: "planted" }).select("path"),
        "paths update": await client.from("site_paths").update({ path: "taken-over" }).eq("site_id", S).select("path"),
        "paths delete": await client.from("site_paths").delete().eq("site_id", S).select("path"),
        "versions insert": await client.from("page_versions").insert({ page_id: S, version_no: 2, document: { version: 1, blocks: [] }, published_at: new Date().toISOString() }).select("id"),
        "versions update": await client.from("page_versions").update({ document: { version: 1, blocks: [], planted: true } }).eq("id", version.data!.id).select("id"),
        "versions delete": await client.from("page_versions").delete().eq("id", version.data!.id).select("id"),
        "themes insert": await client.from("themes").insert({ owner_id: f.owner.userId, name: "Planted", tokens }).select("id"),
        "themes update": await client.from("themes").update({ name: "Taken over" }).eq("id", theme.data!.id).select("id"),
        "themes delete": await client.from("themes").delete().eq("id", theme.data!.id).select("id"),
        // Step 3, "write only pages.draft": the live copy of S is not a member's to change.
        "pages published": await client.from("pages").update({ published: { version: 1, blocks: [], planted: true } as never }).eq("id", S).select("id"),
        "pages published_at": await client.from("pages").update({ published_at: new Date(0).toISOString() }).eq("id", S).select("id"),
        "pages published and published_at": await client
          .from("pages")
          .update({ published: { version: 1, blocks: [], planted: true } as never, published_at: new Date(0).toISOString() })
          .eq("id", S)
          .select("id"),
      };
      for (const [probe, res] of Object.entries(probes)) expect(touched(res), `${who}: ${probe}`).toBe(0);
      expect(await snapshot(), who).toEqual(before);
    };
    for (const [who, client] of [["stranger", asX], ["anon", anon], ["editor", asE], ["publisher", asP]] as const) {
      await writeProbe(who, client);
    }
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
    // Step 5 for every other table: the removed editor's client writes nothing either.
    expect(writeProbe).not.toBeNull();
    await writeProbe!("removed editor", asE);
    // ...and reads none of the member-readable tables: no revision, term, version, old slug,
    // schedule, and none of the owner's saved themes.
    expect(readProbe).not.toBeNull();
    await readProbe!("removed editor", asE);
  });
});
