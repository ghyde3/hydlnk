import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { link, siteTools, type Site } from "./m15-per-page-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M16-08: a menu item that names this site's Post type survives Publish design and Publish all
 * changes (the blog on or off: the live site hides it while the blog is off), and a type id of
 * another site is dropped like any id that is not this site's. Against the local Supabase.
 */

const { run } = await stackIsUp();

describe.skipIf(!run)("M16-08 the archive's menu item through Publish (local Supabase)", () => {
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

  const postType = async (site: Site): Promise<string> => {
    const row = await admin
      .from("content_types")
      .select("id")
      .eq("site_id", site.owner.pageId)
      .eq("key", "post")
      .single();
    if (row.error) throw new Error(row.error.message);
    return row.data.id as string;
  };
  const enable = async (typeId: string, enabled: boolean) => {
    const { error } = await admin.from("content_types").update({ enabled }).eq("id", typeId);
    if (error) throw new Error(error.message);
  };
  const publishAll = (site: Site) =>
    core.publishPageCore({ pageId: site.owner.pageId, userId: site.owner.userId }, { admin });
  const publishDesign = async (site: Site) =>
    core.publishDesignCore(
      {
        pageId: site.owner.pageId,
        expectedRev: (await tools.pageRow(site)).draft_rev,
        userId: site.owner.userId,
      },
      { admin },
    );
  const liveItems = async (site: Site) =>
    ((await tools.pageRow(site)).published as { nav?: { items: string[] } }).nav?.items;

  it("Publish all changes keeps this site's Post type id and drops another site's", async () => {
    const site = await tools.site("ma1", [link("home-link-001")], owners);
    const other = await tools.site("ma2", [link("home-link-002")], owners);
    const page = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const mine = await postType(site);
    const theirs = await postType(other);
    await enable(mine, true);
    await tools.setDesign(site, { nav: { show: true, items: [page, mine, theirs] } });

    expect(await publishAll(site)).toMatchObject({ ok: true });
    expect(await liveItems(site)).toEqual([page, mine]);
  });

  it("Publish design keeps it too, and is not blocked while the blog is off", async () => {
    const site = await tools.site("ma3", [link("home-link-001")], owners);
    const other = await tools.site("ma4", [link("home-link-002")], owners);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    const mine = await postType(site);
    const theirs = await postType(other);
    await enable(mine, true);
    await tools.setDesign(site, { nav: { show: true, items: [mine, theirs] } });
    expect(await publishDesign(site)).toMatchObject({ ok: true });
    expect(await liveItems(site)).toEqual([mine]);

    // Off: the item stays stored (the live menu skips it) and comes back with the blog.
    await enable(mine, false);
    await tools.setDesign(site, { nav: { show: true, items: [mine] }, share: { title: "x" } });
    expect(await publishDesign(site)).toMatchObject({ ok: true });
    expect(await liveItems(site)).toEqual([mine]);
  });
});
