// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-08, M19-09 (T1, T10, T11, T13, T14): the team cores against the local stack. The owner invites
 * (Studio only), the link is returned once and emailed, only the hash is stored; the invited address
 * accepts once (the role comes from the invite); another account, a used, expired or revoked link
 * are refused with one message each; members manage nothing.
 */
const { run } = await stackIsUp();
const core = await import("@/lib/team/core");

describe.skipIf(!run)("M19-08 invites (local Supabase)", () => {
  let admin: SupabaseClient;
  let o: TestOwner;
  let pro: TestOwner;
  let e: TestOwner;
  let x: TestOwner;
  const sent: Array<{ to: string; role: string; url: string }> = [];
  const deps = {
    appOrigin: "http://app.localhost:3000",
    send: async (to: string, role: string, url: string) => {
      sent.push({ to, role, url });
      return "sent" as const;
    },
  };

  beforeAll(async () => {
    admin = adminClient();
    [o, pro, e, x] = await Promise.all([
      makeOwner(admin, "m19inv-o", undefined, "studio"),
      makeOwner(admin, "m19inv-pro", undefined, "pro"),
      makeOwner(admin, "m19inv-e"),
      makeOwner(admin, "m19inv-x"),
    ]);
  });
  afterAll(async () => removeOwners(admin, [o, pro, e, x].filter(Boolean)));

  const tokenOf = (url: string) => url.split("/invite/")[1]!;

  it("M19-08 the owner invites; the link is shown once and emailed; only its hash is stored", async () => {
    const out = await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: ` ${e.email.toUpperCase()} `, role: "editor" }, deps);
    expect(out.ok && out.emailed).toBe("sent");
    if (!out.ok) throw new Error(out.error);
    expect(out.inviteUrl).toMatch(/^http:\/\/app\.localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(sent.at(-1)).toEqual({ to: e.email.toLowerCase(), role: "editor", url: out.inviteUrl });
    const team = await core.loadTeamCore(admin as never, { actorId: o.userId, siteId: o.pageId });
    expect(team!.invites).toEqual([expect.objectContaining({ email: e.email.toLowerCase(), role: "editor" })]);
    expect(JSON.stringify(team)).not.toContain(tokenOf(out.inviteUrl));
  });

  it("M19-08 another account cannot accept; the invited one accepts once with the invite's role", async () => {
    const out = await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: x.email, role: "publisher" }, deps);
    if (!out.ok) throw new Error(out.error);
    const token = tokenOf(out.inviteUrl);
    expect(await core.acceptInviteCore(admin as never, { userId: e.userId, token })).toMatchObject({ ok: false, error: "invite_email" });
    expect(await core.acceptInviteCore(admin as never, { userId: x.userId, token })).toEqual({ ok: true, siteId: o.pageId });
    const replay = await core.acceptInviteCore(admin as never, { userId: x.userId, token });
    expect(replay).toEqual(core.teamFailure("invite_used"));
    const team = await core.loadTeamCore(admin as never, { actorId: o.userId, siteId: o.pageId });
    expect(team!.members).toEqual([expect.objectContaining({ userId: x.userId, role: "publisher" })]);
  });

  it("M19-08 a revoked, an unknown and a malformed link answer the same message", async () => {
    const first = await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: "later-m19@example.com", role: "editor" }, deps);
    if (!first.ok) throw new Error(first.error);
    const team = await core.loadTeamCore(admin as never, { actorId: o.userId, siteId: o.pageId });
    const invite = team!.invites.find((i) => i.email === "later-m19@example.com")!;
    expect(await core.revokeInviteCore(admin as never, { actorId: x.userId, inviteId: invite.id })).toMatchObject({ ok: false, error: "not_found" });
    expect(await core.revokeInviteCore(admin as never, { actorId: o.userId, inviteId: invite.id })).toEqual({ ok: true });
    const used = core.teamFailure("invite_used");
    expect(await core.acceptInviteCore(admin as never, { userId: e.userId, token: tokenOf(first.inviteUrl) })).toEqual(used);
    expect(await core.acceptInviteCore(admin as never, { userId: e.userId, token: "A".repeat(43) })).toEqual(used);
    expect(await core.acceptInviteCore(admin as never, { userId: e.userId, token: "garbage" })).toEqual(used);
    // An expired link answers the same P0002 in SQL (pgTAP 225: the team schema is not reachable
    // over the API to age a row from here).
  });

  it("M19-09 Studio only; a member manages nothing; bad input is refused before the database", async () => {
    expect(await core.inviteMemberCore(admin as never, { actorId: pro.userId, siteId: pro.pageId, email: "a-m19@example.com", role: "editor" }, deps)).toMatchObject({ ok: false, error: "team_plan" });
    expect(await core.inviteMemberCore(admin as never, { actorId: x.userId, siteId: o.pageId, email: "a-m19@example.com", role: "publisher" }, deps)).toMatchObject({ ok: false, error: "not_found" });
    expect(await core.setMemberRoleCore(admin as never, { actorId: x.userId, siteId: o.pageId, userId: x.userId, role: "publisher" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await core.loadTeamCore(admin as never, { actorId: x.userId, siteId: o.pageId })).toBeNull();
    expect(await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: "not an address", role: "editor" }, deps)).toMatchObject({ ok: false, error: "invalid_email" });
    expect(await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: "a-m19@example.com", role: "owner" }, deps)).toMatchObject({ ok: false, error: "invalid_role" });
    expect(await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: o.email, role: "editor" }, deps)).toMatchObject({ ok: false, error: "invite_owner" });
    expect(await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: x.email, role: "editor" }, deps)).toMatchObject({ ok: false, error: "already_member" });
  });

  it("M19-08 a failed email keeps the invite and says so, without the address in the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await core.inviteMemberCore(admin as never, { actorId: o.userId, siteId: o.pageId, email: "smtp-down-m19@example.com", role: "editor" },
      { ...deps, send: async () => { throw new Error("smtp-down-m19@example.com refused"); } });
    expect(out).toMatchObject({ ok: true, emailed: "failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("smtp-down-m19");
    log.mockRestore();
  });

  it("M19-09 a member leaves; the activity log records the team's actions", async () => {
    expect(await core.leaveSiteCore(admin as never, { userId: x.userId, siteId: o.pageId })).toEqual({ ok: true });
    const team = await core.loadTeamCore(admin as never, { actorId: o.userId, siteId: o.pageId });
    expect(team!.members).toEqual([]);
    expect(team!.activity.map((a) => a.action)).toEqual(expect.arrayContaining(["member_left", "member_joined", "member_invited"]));
  });
});
