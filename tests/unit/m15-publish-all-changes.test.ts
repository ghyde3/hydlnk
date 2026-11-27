import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { link, pageLink, recording, siteTools, wrote, type Site } from "./m15-per-page-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M15-10 Publish all changes: `publishPageCore` with the revs the editor holds. A stale design or
 * page rev is a conflict with nothing written; without `expected` (MCP) no rev is checked; unchanged
 * pages keep their publish date; a link or menu item to a page that is not live never blocks it.
 */

const { run } = await stackIsUp();

describe.skipIf(!run)("M15-10 publishPageCore with expected revs (local Supabase)", () => {
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

  const held = async (site: Site, ids: string[]) => ({
    designRev: (await tools.pageRow(site)).draft_rev,
    entries: Object.fromEntries(
      await Promise.all(ids.map(async (id) => [id, (await tools.entry(id)).rev] as const)),
    ),
  });
  const publish = (
    site: Site,
    expected?: import("@/lib/publish/core").PublishExpected,
    client: SupabaseClient = admin,
  ) =>
    core.publishPageCore(
      {
        pageId: site.owner.pageId,
        userId: site.owner.userId,
        ...(expected ? { expected } : {}),
      },
      { admin: client },
    );
  const conflict = { ok: false, errors: [], reason: "conflict" };

  it("publishes when every rev the editor holds is the stored one", async () => {
    const site = await tools.site("pa1", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const spy = recording(admin);
    expect(await publish(site, await held(site, [site.homeId, a]), spy.client)).toMatchObject({
      ok: true,
    });
    expect(wrote(spy.calls)).toEqual(["publish_site_revs"]);
    expect((await tools.entry(a)).published).not.toBeNull();
  });

  it("a stale design rev answers conflict, with no rpc and nothing published", async () => {
    const site = await tools.site("pa2", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const expected = await held(site, [site.homeId, a]);
    // Another tab saves the design.
    await tools.setDesign(site, { rev: 7 });
    const spy = recording(admin);
    expect(await publish(site, expected, spy.client)).toEqual(conflict);
    expect(wrote(spy.calls)).toEqual([]);
    expect((await tools.pageRow(site)).published).toBeNull();
    expect((await tools.entry(a)).published).toBeNull();
  });

  it("a stale page rev, Home's or a sub-page's, answers conflict with nothing written", async () => {
    const site = await tools.site("pa3", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const expected = await held(site, [site.homeId, a]);
    const spy = recording(admin);
    expect(
      await publish(
        site,
        { ...expected, entries: { ...expected.entries, [a]: expected.entries[a]! + 1 } },
        spy.client,
      ),
    ).toEqual(conflict);
    expect(
      await publish(
        site,
        { ...expected, entries: { ...expected.entries, [site.homeId]: 99 } },
        spy.client,
      ),
    ).toEqual(conflict);
    // A page the site does not have (deleted elsewhere, or another site's).
    expect(
      await publish(
        site,
        {
          ...expected,
          entries: { ...expected.entries, "00000000-0000-4000-8000-00000000dead": 1 },
        },
        spy.client,
      ),
    ).toEqual(conflict);
    // Something that is not the shape at all.
    expect(await publish(site, { designRev: 3, entries: [] } as never, spy.client)).toEqual(
      conflict,
    );
    expect(wrote(spy.calls)).toEqual([]);
    expect((await tools.pageRow(site)).published).toBeNull();
  });

  it("without expected (the MCP path) no rev is checked and the site publishes", async () => {
    const site = await tools.site("pa4", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    await tools.setDesign(site, { rev: 41 });
    expect(await publish(site)).toMatchObject({ ok: true });
    expect((await tools.entry(a)).published).not.toBeNull();
  });

  it("unchanged pages keep their publish date; a changed page and a new page go live", async () => {
    const site = await tools.site("pa5", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Old A")]);
    const b = await tools.sub(site, "About", "about", [link("b-link-00001")]);
    expect(await publish(site)).toMatchObject({ ok: true });
    const before = { home: await tools.entry(site.homeId), b: await tools.entry(b) };
    const aBefore = await tools.entry(a);
    await tools.setDraft(a, { ...aBefore.draft, blocks: [link("a-link-00001", "New A")] });
    const fresh = await tools.sub(site, "Soon", "soon", [link("s-link-00001")]);

    expect(await publish(site, await held(site, [site.homeId, a, b, fresh]))).toMatchObject({
      ok: true,
    });
    expect((await tools.entry(a)).published!.blocks![0]!.label).toBe("New A");
    expect((await tools.entry(a)).published_at).not.toBe(aBefore.published_at);
    expect((await tools.entry(fresh)).published).not.toBeNull();
    expect((await tools.entry(b)).published_at).toBe(before.b.published_at);
    expect((await tools.entry(site.homeId)).published_at).toBe(before.home.published_at);
  });

  it("a page link and a menu item to a never-published page do not block Publish page or design", async () => {
    // Publish all makes every page live, so "never published" exists only between publishes: the
    // per-page gates are what meet it. Here Publish all itself goes through with both in place.
    const site = await tools.site("pa6", [link("home-link-001")], owners);
    const soon = await tools.sub(site, "Soon", "soon", [link("s-link-00001")]);
    await tools.setDraft(site.homeId, {
      path: "/",
      title: "",
      description: "",
      blocks: [link("home-link-001"), pageLink("home-plink-01", soon)],
    });
    await tools.setDesign(site, { nav: { show: true, items: [soon] } });
    expect(await publish(site, await held(site, [site.homeId, soon]))).toMatchObject({ ok: true });
    expect((await tools.pageRow(site)).published).toMatchObject({ nav: { items: [soon] } });
  });
});
