import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftOf, makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";
import { join } from "./m19t-team-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-05, M19-06, M19-07 (T4, T15): Publish, Publish design, link rules and version history ask the
 * one access helper. Owner O (Studio) with site S; editor E and publisher P are Free accounts.
 *   * the owner publishes as before; a publisher publishes; an editor and a stranger are refused
 *     with what a stranger always got;
 *   * images are checked against the OWNER's folder (a publisher's own folder is refused);
 *   * redirect mode reads the owner's plan (a Free publisher on a Studio site may use it);
 *   * version history: members preview and restore into the draft, under the owner's plan;
 *   * a removed publisher is refused at once.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M19-06 Publish and versions under team access (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  let versions: typeof import("@/lib/versions/core");
  let linkRules: typeof import("@/lib/publish/link-rules");
  let o: TestOwner;
  let e: TestOwner;
  let p: TestOwner;
  let x: TestOwner;
  const objects: string[] = [];

  beforeAll(async () => {
    admin = adminClient();
    core = await import("@/lib/publish/core");
    versions = await import("@/lib/versions/core");
    linkRules = await import("@/lib/publish/link-rules");
    o = await makeOwner(admin, "m19pub-o", () => draftOf("Owner site"), "studio");
    await moveHome(admin, o.pageId);
    [e, p, x] = await Promise.all([makeOwner(admin, "m19pub-e"), makeOwner(admin, "m19pub-p"), makeOwner(admin, "m19pub-x")]);
    await join(admin, o, o.pageId, e, "editor");
    await join(admin, o, o.pageId, p, "publisher");
  });
  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    await removeOwners(admin, [o, e, p, x].filter(Boolean));
  });

  const publish = (userId: string, source?: "editor" | "mcp") =>
    core.publishPageCore({ pageId: o.pageId, userId, ...(source ? { source } : {}) }, { admin });

  it("M19-06 the owner and a publisher publish; an editor and a stranger get the stranger's answer", async () => {
    expect(await publish(o.userId)).toMatchObject({ ok: true });
    expect(await publish(p.userId)).toMatchObject({ ok: true });
    const stranger = await publish(x.userId);
    expect(stranger).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await publish(e.userId)).toMatchObject({ ok: false, reason: "forbidden" });
    // M19-13: over MCP a member is refused exactly like a stranger.
    expect(await publish(p.userId, "mcp")).toEqual(stranger);
    expect(await publish(o.userId, "mcp")).toMatchObject({ ok: true });
  });

  it("M19-06 Publish design and Publish page: the publisher may, the editor is forbidden, a stranger not_found", async () => {
    const draftRev = (await admin.from("pages").select("rev:draft->>rev").eq("id", o.pageId).single()).data!.rev as string | null;
    expect(await core.publishDesignCore({ pageId: o.pageId, expectedRev: draftRev, userId: e.userId }, { admin })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await core.publishDesignCore({ pageId: o.pageId, expectedRev: draftRev, userId: x.userId }, { admin })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await core.publishDesignCore({ pageId: o.pageId, expectedRev: draftRev, userId: p.userId }, { admin })).toMatchObject({ ok: true });
    const home = await admin.from("content_entries").select("id, rev").eq("site_id", o.pageId).eq("draft->>path", "/").single();
    expect(await core.publishSitePageCore({ pageId: o.pageId, entryId: home.data!.id, expectedRev: home.data!.rev, userId: e.userId }, { admin })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await core.publishSitePageCore({ pageId: o.pageId, entryId: home.data!.id, expectedRev: home.data!.rev, userId: x.userId }, { admin })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await core.publishSitePageCore({ pageId: o.pageId, entryId: home.data!.id, expectedRev: home.data!.rev, userId: p.userId }, { admin })).toMatchObject({ ok: true });
  });

  it("M19-05 redirect mode reads the OWNER's plan: a Free publisher may use it on a Studio site", async () => {
    const form = { blocks: [{ id: "lnk-aaaaaaaa", type: "link", visible: true, label: "Go", url: "https://example.com/go" }], redirect: { linkId: "lnk-aaaaaaaa" } };
    // R13: the plan is the one the access rule gives the publisher on S (the owner's), never re-read.
    const { requireSiteAccess } = await import("@/lib/access");
    const onS = await requireSiteAccess(admin as never, { actorId: p.userId, siteId: o.pageId, need: "publish", source: "editor" });
    if (!onS.ok) throw new Error(onS.reason);
    expect(onS.access.plan).toBe("studio");
    const asOwnerPlan = await linkRules.checkLinkRules(admin as never, { pageId: o.pageId, plan: onS.access.plan, form: form as never, raw: {} });
    expect(asOwnerPlan.filter((err) => err.field === "redirect")).toEqual([]);
    const onOwn = await requireSiteAccess(admin as never, { actorId: p.userId, siteId: p.pageId, need: "publish", source: "editor" });
    if (!onOwn.ok) throw new Error(onOwn.reason);
    const asFreeAccount = await linkRules.checkLinkRules(admin as never, { pageId: o.pageId, plan: onOwn.access.plan, form: form as never, raw: {} });
    expect(asFreeAccount.some((err) => err.field === "redirect")).toBe(true);
  });

  it("M19-06 images: a publisher's file in the OWNER's folder publishes; one in their own folder is refused", async () => {
    const { makePng } = await import("../e2e/m2/publish-helpers");
    const png = makePng(8, 8);
    const ownerPath = `${o.userId}/m19pub-photo.png`;
    const ownPath = `${p.userId}/m19pub-photo.png`;
    for (const path of [ownerPath, ownPath]) {
      const up = await admin.storage.from("page-media").upload(path, png, { contentType: "image/png", upsert: true });
      expect(up.error, path).toBeNull();
      objects.push(path);
    }
    const withPhoto = async (path: string) => {
      const row = await admin.from("pages").select("draft").eq("id", o.pageId).single();
      const draft = row.data!.draft as { profile: Record<string, unknown> };
      draft.profile = { ...draft.profile, photo: { path, width: 8, height: 8 } };
      const saved = await admin.from("pages").update({ draft: draft as never }).eq("id", o.pageId);
      expect(saved.error).toBeNull();
    };
    await withPhoto(ownPath);
    const refused = await publish(p.userId);
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    expect(refused.ok ? [] : refused.errors.map((err) => err.message)).toContain(
      "That image isn’t in your uploads. Upload it again.",
    );
    await withPhoto(ownerPath);
    const okay = await publish(p.userId);
    expect(okay.ok, JSON.stringify(okay)).toBe(true);
  });

  it("M19-06 versions: members preview and restore into the draft; a stranger is refused", async () => {
    const list = await admin.from("page_versions").select("id").eq("page_id", o.pageId).order("version_no", { ascending: false }).limit(1);
    const versionId = list.data?.[0]?.id;
    expect(versionId).toBeTruthy();
    expect(await versions.loadVersionPreviewCore({ pageId: o.pageId, versionId, userId: e.userId }, { admin })).toMatchObject({ ok: true });
    expect(await versions.loadVersionPreviewCore({ pageId: o.pageId, versionId, userId: x.userId }, { admin })).toMatchObject({ ok: false, reason: "forbidden" });
    const restored = await versions.restorePageVersionCore({ pageId: o.pageId, versionId, userId: e.userId }, { admin });
    expect(restored.ok, JSON.stringify(restored)).toBe(true);
    expect(await versions.restorePageVersionCore({ pageId: o.pageId, versionId, userId: x.userId }, { admin })).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("M19-11 a removed publisher's next publish is refused", async () => {
    await admin.rpc("remove_site_member", { p_site: o.pageId, p_actor: o.userId, p_user: p.userId });
    expect(await publish(p.userId)).toMatchObject({ ok: false, reason: "forbidden" });
  });
});
