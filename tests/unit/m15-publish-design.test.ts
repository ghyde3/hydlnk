import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishedDocSchema } from "@/lib/document";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { link, recording, siteTools, wrote, type Site } from "./m15-per-page-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M15-10 Publish design: `publishDesignCore` makes theme, menu and profile live and leaves every
 * page as it is, against the local Supabase.
 */

const { run } = await stackIsUp();
const DESIGN_KEYS = Object.keys(publishedDocSchema.shape).filter((key) => key !== "blocks");
const profile = (name: string) => ({ name, bio: "A bio.", photo: null });

describe.skipIf(!run)("M15-10 publishDesignCore (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  let tools: ReturnType<typeof siteTools>;
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
    tools = siteTools(admin);
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  const publishAll = (site: Site) =>
    core.publishPageCore({ pageId: site.owner.pageId, userId: site.owner.userId }, { admin });
  const publishDesign = async (
    site: Site,
    client: SupabaseClient = admin,
    opts: { rev?: string | null; userId?: string } = {},
  ) =>
    core.publishDesignCore(
      {
        pageId: site.owner.pageId,
        expectedRev: opts.rev !== undefined ? opts.rev : (await tools.pageRow(site)).draft_rev,
        userId: opts.userId ?? site.owner.userId,
      },
      { admin: client },
    );

  it("sends only allowlisted keys and no blocks; no page entry changes", async () => {
    const site = await tools.site("pd1", [link("home-link-001", "Old home")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Old A")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    const before = { home: await tools.entry(site.homeId), a: await tools.entry(a) };
    await tools.setDesign(site, { profile: profile("Renamed") });
    // Drafts of both pages change too: Publish design must not take them along.
    await tools.setDraft(site.homeId, {
      ...before.home.draft,
      blocks: [link("home-link-001", "New home")],
    });
    await tools.setDraft(a, { ...before.a.draft, blocks: [link("a-link-00001", "New A")] });

    const spy = recording(admin);
    expect(await publishDesign(site, spy.client)).toMatchObject({ ok: true });
    expect(wrote(spy.calls)).toEqual(["publish_design"]);
    const sent = (spy.args.publish_design as { p_design: Record<string, unknown> }).p_design;
    expect(sent).not.toHaveProperty("blocks");
    for (const key of Object.keys(sent)) expect(DESIGN_KEYS).toContain(key);
    expect(sent).toMatchObject({ version: 1, profile: { name: "Renamed" } });
    expect(sent).toHaveProperty("tokens");

    const page = await tools.pageRow(site);
    expect((page.published as { profile: { name: string } }).profile.name).toBe("Renamed");
    for (const [id, was] of [
      [site.homeId, before.home],
      [a, before.a],
    ] as const) {
      const now = await tools.entry(id);
      expect(now.published).toEqual(was.published);
      expect(now.published_at).toBe(was.published_at);
    }
  });

  it("a stale rev answers conflict and writes nothing; so does a missing one", async () => {
    const site = await tools.site("pd2", [link("home-link-001")], owners);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    await tools.setDesign(site, { profile: profile("Renamed") });
    const before = await tools.pageRow(site);
    const spy = recording(admin);
    const conflict = { ok: false, errors: [], reason: "conflict" };
    expect(await publishDesign(site, spy.client, { rev: "999" })).toEqual(conflict);
    expect(await publishDesign(site, spy.client, { rev: null })).toEqual(conflict);
    expect(wrote(spy.calls)).toEqual([]);
    const after = await tools.pageRow(site);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
  });

  it("another owner's site answers not_found, with no rpc and nothing written", async () => {
    const mine = await tools.site("pd3", [link("home-link-001")], owners);
    const theirs = await tools.site("pd4", [link("home-link-002")], owners);
    expect(await publishAll(theirs)).toMatchObject({ ok: true });
    await tools.setDesign(theirs, { profile: profile("Hijacked") });
    const before = await tools.pageRow(theirs);
    const spy = recording(admin);
    expect(await publishDesign(theirs, spy.client, { userId: mine.owner.userId })).toEqual({
      ok: false,
      errors: [],
      reason: "not_found",
    });
    expect(
      await core.publishDesignCore(
        { pageId: "not-a-uuid", expectedRev: "1", userId: mine.owner.userId },
        { admin: spy.client },
      ),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(wrote(spy.calls)).toEqual([]);
    expect((await tools.pageRow(theirs)).published).toEqual(before.published);
  });

  it("a menu item pointing at a never-published page is kept and publishes", async () => {
    const site = await tools.site("pd5", [link("home-link-001")], owners);
    const live = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    const draftOnly = await tools.sub(site, "Soon", "soon", [link("s-link-00001")]);
    await tools.setDesign(site, { nav: { show: true, items: [live, draftOnly] } });

    expect(await publishDesign(site)).toMatchObject({ ok: true });
    expect((await tools.pageRow(site)).published).toMatchObject({
      nav: { show: true, items: [live, draftOnly] },
    });
    expect((await tools.entry(draftOnly)).published).toBeNull();
  });

  it("a problem in Home's blocks does not block Publish design; a design problem does", async () => {
    const site = await tools.site("pd6", [link("home-link-001", "Old home")], owners);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    // Home's draft cannot be published: a link without a label.
    const homeDraft = (await tools.entry(site.homeId)).draft;
    await tools.setDraft(site.homeId, { ...homeDraft, blocks: [link("home-link-001", "")] });
    expect(await publishAll(site)).toMatchObject({ ok: false, reason: "invalid" });

    await tools.setDesign(site, { profile: profile("Renamed") });
    expect(await publishDesign(site)).toMatchObject({ ok: true });
    expect((await tools.entry(site.homeId)).published!.blocks![0]!.label).toBe("Old home");

    await tools.setDesign(site, { profile: profile("") });
    const spy = recording(admin);
    const refused = await publishDesign(site, spy.client);
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    if (!refused.ok) expect(refused.errors[0]).toMatchObject({ blockId: null });
    expect(wrote(spy.calls)).toEqual([]);
  });

  it("a site that was never published is refused with the message", async () => {
    const site = await tools.site("pd7", [link("home-link-001")], owners);
    const spy = recording(admin);
    expect(await publishDesign(site, spy.client)).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        {
          blockId: null,
          field: "document",
          message: "This site isn’t live yet. Use Publish all changes first.",
        },
      ],
    });
    expect(wrote(spy.calls)).toEqual([]);
  });

  it("records a version: the new design with Home's live blocks", async () => {
    const site = await tools.site("pd8", [link("home-link-001", "Live home")], owners);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    await tools.setDesign(site, { profile: profile("Renamed") });
    expect(await publishDesign(site)).toMatchObject({ ok: true });
    const versions = await admin
      .from("page_versions")
      .select("version_no, document")
      .eq("page_id", site.owner.pageId)
      .order("version_no", { ascending: false });
    expect(versions.data!.length).toBe(2);
    expect(versions.data![0]!.document).toMatchObject({
      profile: { name: "Renamed" },
      blocks: [{ id: "home-link-001", label: "Live home" }],
    });
  });
});
