import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { link, pageLink, recording, siteTools, wrote, type Site } from "./m15-per-page-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M15-10 Publish page: `publishSitePageCore` makes one page's draft live and nothing else, against
 * the local Supabase. A stale rev is a conflict, another owner's site is not found, and a link to a
 * page that is not live never blocks it.
 */

const { run } = await stackIsUp();
const home = (blocks: object[]) => ({ path: "/", title: "", description: "", blocks });
const NOT_LIVE = "This site isn’t live yet. Use Publish all changes first.";

describe.skipIf(!run)("M15-10 publishSitePageCore (local Supabase)", () => {
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
  const publishOne = (
    site: Site,
    entryId: string,
    expectedRev: number,
    client: SupabaseClient = admin,
    userId: string = site.owner.userId,
  ) =>
    core.publishSitePageCore(
      { pageId: site.owner.pageId, entryId, expectedRev, userId },
      { admin: client },
    );

  it("publishes only that page: one publish_site_page call, every other copy and date unchanged", async () => {
    const site = await tools.site("pp1", [link("home-link-001", "Old home")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Old A")]);
    const b = await tools.sub(site, "About", "about", [link("b-link-00001", "Old B")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    const before = {
      home: await tools.entry(site.homeId),
      b: await tools.entry(b),
      page: await tools.pageRow(site),
      a: await tools.entry(a),
    };

    // All three drafts change; only A is published.
    await tools.setDraft(site.homeId, home([link("home-link-001", "New home")]));
    await tools.setDraft(b, { ...before.b.draft, blocks: [link("b-link-00001", "New B")] });
    await tools.setDraft(a, { ...before.a.draft, blocks: [link("a-link-00001", "New A")] });

    const spy = recording(admin);
    const result = await publishOne(site, a, (await tools.entry(a)).rev, spy.client);
    expect(result).toMatchObject({ ok: true, unchanged: false });
    expect(wrote(spy.calls)).toEqual(["publish_site_page"]);
    expect(spy.args.publish_site_page).toMatchObject({
      p_site_id: site.owner.pageId,
      p_owner_id: site.owner.userId,
      p_entry_id: a,
      p_source: "editor",
    });

    const after = await tools.entry(a);
    expect(after.published!.blocks![0]!.label).toBe("New A");
    expect(after.published_at).not.toBe(before.a.published_at);
    if (result.ok) expect(result.rev).toBe(after.rev);
    // Home, the other page and the site row: live copies and dates exactly as they were.
    const homeAfter = await tools.entry(site.homeId);
    expect(homeAfter.published).toEqual(before.home.published);
    expect(homeAfter.published_at).toBe(before.home.published_at);
    const bAfter = await tools.entry(b);
    expect(bAfter.published).toEqual(before.b.published);
    expect(bAfter.published_at).toBe(before.b.published_at);
    const pageAfter = await tools.pageRow(site);
    expect(pageAfter.published).toEqual(before.page.published);
    expect(pageAfter.published_at).toBe(before.page.published_at);
  });

  it("publishes Home's own blocks the same way, leaving the sub-page and the design alone", async () => {
    const site = await tools.site("pp2", [link("home-link-001", "Old home")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Old A")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    const before = { a: await tools.entry(a), page: await tools.pageRow(site) };
    await tools.setDraft(site.homeId, home([link("home-link-001", "New home")]));
    await tools.setDesign(site, { profile: { name: "Renamed", bio: "A bio.", photo: null } });

    const spy = recording(admin);
    const rev = (await tools.entry(site.homeId)).rev;
    expect(await publishOne(site, site.homeId, rev, spy.client)).toMatchObject({ ok: true });
    expect(wrote(spy.calls)).toEqual(["publish_site_page"]);
    const live = (await tools.entry(site.homeId)).published!;
    expect(live).toMatchObject({ path: "/", blocks: [{ id: "home-link-001", label: "New home" }] });
    expect((await tools.entry(a)).published_at).toBe(before.a.published_at);
    const page = await tools.pageRow(site);
    expect(page.published_at).toBe(before.page.published_at);
    expect((page.published as { profile: { name: string } }).profile.name).toBe("Alpha");
  });

  it("a stale rev answers conflict with currentRev and writes nothing", async () => {
    const site = await tools.site("pp3", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Old A")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    const before = await tools.entry(a);
    await tools.setDraft(a, { ...before.draft, blocks: [link("a-link-00001", "New A")] });
    const current = (await tools.entry(a)).rev;

    const spy = recording(admin);
    const result = await publishOne(site, a, current + 5, spy.client);
    expect(result).toEqual({ ok: false, errors: [], reason: "conflict", currentRev: current });
    expect(wrote(spy.calls)).toEqual([]);
    const after = await tools.entry(a);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
  });

  it("another owner's site, an entry of another site and a trashed entry answer not_found, with no rpc", async () => {
    const mine = await tools.site("pp4", [link("home-link-001")], owners);
    const a = await tools.sub(mine, "Items", "items", [link("a-link-00001")]);
    const theirs = await tools.site("pp5", [link("home-link-002")], owners);
    const x = await tools.sub(theirs, "Theirs", "theirs", [link("x-link-00001")]);
    expect(await publishAll(mine)).toMatchObject({ ok: true });
    expect(await publishAll(theirs)).toMatchObject({ ok: true });
    const notFound = { ok: false, errors: [], reason: "not_found" };
    const xBefore = await tools.entry(x);

    const spy = recording(admin);
    // Their site, with my session.
    expect(await publishOne(theirs, x, xBefore.rev, spy.client, mine.owner.userId)).toEqual(
      notFound,
    );
    // Their entry, under my own site id.
    expect(await publishOne(mine, x, xBefore.rev, spy.client)).toEqual(notFound);
    // Their Home entry, under my own site id.
    expect(await publishOne(mine, theirs.homeId, 1, spy.client)).toEqual(notFound);
    // An unknown site and a malformed entry id.
    expect(
      await core.publishSitePageCore(
        {
          pageId: "00000000-0000-4000-8000-000000000001",
          entryId: a,
          expectedRev: 1,
          userId: mine.owner.userId,
        },
        { admin: spy.client },
      ),
    ).toEqual(notFound);
    expect(await publishOne(mine, "not-a-uuid", 1, spy.client)).toEqual(notFound);
    // A trashed page of my own site.
    await admin
      .from("content_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", a);
    expect(await publishOne(mine, a, (await tools.entry(a)).rev, spy.client)).toEqual(notFound);

    expect(wrote(spy.calls)).toEqual([]);
    const xAfter = await tools.entry(x);
    expect(xAfter.published).toEqual(xBefore.published);
    expect(xAfter.published_at).toBe(xBefore.published_at);
  });

  it("no session answers unauthorized before anything is read", async () => {
    const spy = recording(admin);
    expect(
      await core.publishSitePageCore(
        {
          pageId: "00000000-0000-4000-8000-000000000001",
          entryId: "00000000-0000-4000-8000-000000000002",
          expectedRev: 1,
          userId: null,
        },
        { admin: spy.client },
      ),
    ).toEqual({ ok: false, errors: [], reason: "unauthorized" });
    expect(spy.calls).toEqual([]);
  });

  it("Home and a sub-page that link to a never-published page both publish", async () => {
    const site = await tools.site("pp6", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    // A page added after the last publish: a draft, never live.
    const draftOnly = await tools.sub(site, "Soon", "soon", [link("s-link-00001")]);
    await tools.setDraft(
      site.homeId,
      home([link("home-link-001"), pageLink("home-plink-01", draftOnly)]),
    );
    const aDraft = (await tools.entry(a)).draft;
    await tools.setDraft(a, {
      ...aDraft,
      blocks: [link("a-link-00001"), pageLink("a-plink-0001", draftOnly)],
    });

    const homeRev = (await tools.entry(site.homeId)).rev;
    expect(await publishOne(site, site.homeId, homeRev)).toMatchObject({ ok: true });
    expect(await publishOne(site, a, (await tools.entry(a)).rev)).toMatchObject({ ok: true });
    expect((await tools.entry(site.homeId)).published!.blocks!.map((b) => b.id)).toContain(
      "home-plink-01",
    );
    expect((await tools.entry(a)).published!.blocks!.map((b) => b.id)).toContain("a-plink-0001");
    // The target itself stays a draft.
    expect((await tools.entry(draftOnly)).published).toBeNull();
  });

  it("a page link to a page of another site is still refused, naming the block", async () => {
    const site = await tools.site("pp7", [link("home-link-001")], owners);
    const other = await tools.site("pp8", [link("home-link-002")], owners);
    const foreign = await tools.sub(other, "Theirs", "theirs");
    expect(await publishAll(site)).toMatchObject({ ok: true });
    await tools.setDraft(
      site.homeId,
      home([link("home-link-001"), pageLink("home-plink-01", foreign)]),
    );
    const spy = recording(admin);
    const result = await publishOne(
      site,
      site.homeId,
      (await tools.entry(site.homeId)).rev,
      spy.client,
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({ blockId: "home-plink-01", field: "target" }),
      ]);
    }
    expect(wrote(spy.calls)).toEqual([]);
  });

  it("a site that was never published is refused with the message, nothing written", async () => {
    const site = await tools.site("pp9", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const spy = recording(admin);
    const result = await publishOne(site, a, (await tools.entry(a)).rev, spy.client);
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ blockId: null, field: "document", message: NOT_LIVE }],
    });
    expect(wrote(spy.calls)).toEqual([]);
    expect((await tools.entry(a)).published).toBeNull();
  });

  it("a design problem does not block Publish page; the page's own problem does, and names it", async () => {
    const site = await tools.site("pp10", [link("home-link-001", "Old home")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Old A")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    // The design draft cannot be published: no profile name.
    await tools.setDesign(site, { profile: { name: "", bio: "", photo: null } });
    expect(await publishAll(site)).toMatchObject({ ok: false, reason: "invalid" });

    const aDraft = (await tools.entry(a)).draft;
    await tools.setDraft(a, { ...aDraft, blocks: [link("a-link-00001", "New A")] });
    expect(await publishOne(site, a, (await tools.entry(a)).rev)).toMatchObject({ ok: true });
    await tools.setDraft(site.homeId, home([link("home-link-001", "New home")]));
    expect(await publishOne(site, site.homeId, (await tools.entry(site.homeId)).rev)).toMatchObject(
      { ok: true },
    );

    // The page's own problem: a link without a label.
    await tools.setDraft(a, { ...aDraft, blocks: [link("a-link-00001", "")] });
    const refused = await publishOne(site, a, (await tools.entry(a)).rev);
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    if (!refused.ok) {
      expect(refused.errors).toEqual([
        expect.objectContaining({ blockId: "a-link-00001", field: "label", subPageId: a }),
      ]);
    }
    expect((await tools.entry(a)).published!.blocks![0]!.label).toBe("New A");
  });

  it("publishing a page whose live copy is already this draft changes nothing", async () => {
    const site = await tools.site("pp11", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    const before = await tools.entry(a);
    const result = await publishOne(site, a, before.rev);
    expect(result).toMatchObject({ ok: true, unchanged: true, rev: before.rev });
    expect((await tools.entry(a)).published_at).toBe(before.published_at);
  });
});
