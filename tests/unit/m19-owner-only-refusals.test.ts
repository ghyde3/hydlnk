// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { removeOwners, stackIsUp } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";
import { fixtureUsers, teamFixture, tokenHash, type TeamFixture } from "./m19t-team-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-07 (B1, B6, B8, B9, A28): the owner-only operations refuse a PUBLISHER of the site, the most a
 * member can be, and change nothing: unpublishing the site, the domains (add, check, move, remove;
 * Vercel is never called), the share links (create, list, revoke), the team (revoke an invite, remove
 * a member). Analytics and Audience are owner-only screens (m19-access-static pins their isOwner
 * check; the e2e specs open them as members and get the 404).
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M19-07 owner-only operations refuse a publisher (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let f: TeamFixture;
  let domainId: string;
  let linkId: string;
  let inviteId: string;
  const vercelCalls: string[] = [];

  beforeAll(async () => {
    admin = adminClient() as SupabaseClient<Database>;
    f = await teamFixture(admin as never, "m19oo");
    await admin.from("pages").update({ published: { version: 1 } as never, published_at: new Date().toISOString() }).eq("id", f.owner.pageId);
    const domain = await admin
      .from("domains")
      .insert({ page_id: f.owner.pageId, hostname: `m19oo-${Date.now()}.example.com`, status: "verified", verified_at: new Date().toISOString() })
      .select("id")
      .single();
    if (domain.error) throw new Error(domain.error.message);
    domainId = domain.data.id;
    const link = await admin
      .from("preview_links")
      .insert({ page_id: f.owner.pageId, token_hash: tokenHash(`m19oo-${Date.now()}`), expires_at: new Date(Date.now() + 86_400_000).toISOString() } as never)
      .select("id")
      .single();
    if (link.error) throw new Error(link.error.message);
    linkId = (link.data as { id: string }).id;
    const invite = await admin.rpc("create_site_invite", {
      p_site: f.owner.pageId,
      p_actor: f.owner.userId,
      p_email: "later-m19oo@example.com",
      p_token_hash: tokenHash(`m19oo-invite-${Date.now()}`),
      p_role: "editor",
    });
    if (invite.error) throw new Error(invite.error.message);
    inviteId = String(invite.data);
  });
  afterAll(async () => {
    if (f) await removeOwners(admin as never, fixtureUsers(f));
  });

  it("B1: unpublishing the site", async () => {
    const { unpublishSiteCore } = await import("@/lib/publish/unpublish");
    expect(await unpublishSiteCore({ pageId: f.owner.pageId, userId: f.publisher.userId }, { admin })).toMatchObject({ ok: false });
    const page = await admin.from("pages").select("published").eq("id", f.owner.pageId).single();
    expect(page.data!.published).not.toBeNull();
  });

  it("B6: the domains, and Vercel is never asked", async () => {
    const core = await import("@/lib/domains/core");
    const vercel = new Proxy({}, { get: (_t, name) => async () => { vercelCalls.push(String(name)); throw new Error("no Vercel here"); } });
    const deps = { admin, vercel, expirePage: () => undefined, sendLiveEmail: async () => undefined, rootDomain: "localhost:3000" } as never;
    const who = f.publisher.userId;
    for (const [name, result] of [
      ["add", await core.addDomain(deps, who, { hostname: "m19oo-new.example.com", pageId: f.owner.pageId })],
      ["check", await core.checkDomain(deps, who, domainId)],
      ["move", await core.setDomainPage(deps, who, domainId, f.publisher.pageId)],
      ["remove", await core.removeDomain(deps, who, domainId)],
    ] as const) {
      expect(result, name).toMatchObject({ ok: false });
    }
    expect(vercelCalls).toEqual([]);
    const row = await admin.from("domains").select("page_id, status").eq("id", domainId).single();
    expect(row.data).toEqual({ page_id: f.owner.pageId, status: "verified" });
  });

  it("B8: the share links", async () => {
    const core = await import("@/lib/previews/core");
    const deps = { admin, isSuspended: async () => false, limit: async () => ({ allowed: true, retryAfter: 0 }), appOrigin: "http://app.localhost:3000" };
    expect(await core.createPreviewLinkCore(deps, f.publisher.userId, f.owner.pageId)).toMatchObject({ ok: false });
    expect(await core.listPreviewLinksCore(deps, f.publisher.userId, f.owner.pageId)).toMatchObject({ ok: false });
    expect(await core.revokePreviewLinkCore(deps, f.publisher.userId, linkId)).toMatchObject({ ok: false });
    const links = await admin.from("preview_links").select("id, revoked_at").eq("page_id", f.owner.pageId);
    expect(links.data).toEqual([{ id: linkId, revoked_at: null }]);
  });

  it("A28: the team: a publisher can revoke no invite and remove no member", async () => {
    const core = await import("@/lib/team/core");
    expect(await core.revokeInviteCore(admin as never, { actorId: f.publisher.userId, inviteId })).toMatchObject({ ok: false, error: "not_found" });
    expect(await core.removeMemberCore(admin as never, { actorId: f.publisher.userId, siteId: f.owner.pageId, userId: f.editor.userId })).toMatchObject({ ok: false, error: "not_found" });
    const team = await core.loadTeamCore(admin as never, { actorId: f.owner.userId, siteId: f.owner.pageId });
    expect(team!.members.map((m) => m.userId).sort()).toEqual([f.editor.userId, f.publisher.userId].sort());
    expect(team!.invites.map((i) => i.id)).toEqual([inviteId]);
  });
});
