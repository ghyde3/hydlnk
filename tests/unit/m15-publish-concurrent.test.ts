import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishDoc } from "@/lib/document";
import { redirectModeResponse, redirectTargetId } from "@/lib/tenant-render/redirect";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { link, recording, siteTools, wrote, type Site } from "./m15-per-page-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M15-12: a second writer between a publish gate's read and its database call. The timing is forced:
 * the admin client runs `between` right before it forwards the named rpc, so the other write lands
 * after every check of the gate and before the function takes its locks.
 *
 *   - Publish all changes: a save in that window is a conflict and nothing goes live (the function
 *     compares the revs the editor sent under its locks); a page the editor does not hold is one too;
 *   - Publish page: another page going live in that window with the same block id is refused by the
 *     function (HL014) and answered as the gate's own notice;
 *   - a live redirect whose target is not among the live blocks is never served.
 */

const { run } = await stackIsUp();

/** The admin client, with `between` run once, right before the first call of rpc `name` is forwarded. */
function racing(admin: SupabaseClient, name: string, between: () => Promise<void>): SupabaseClient {
  let done = false;
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop !== "rpc") return Reflect.get(target, prop, receiver);
      return (called: string, ...rest: unknown[]) => {
        const forward = () => (target.rpc as (...a: unknown[]) => unknown)(called, ...rest);
        if (called !== name || done) return forward();
        done = true;
        return between().then(forward);
      };
    },
  });
}

describe.skipIf(!run)("M15-12 a second writer between the gate's read and its write", () => {
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
  const publishAll = (
    site: Site,
    expected?: import("@/lib/publish/core").PublishExpected,
    client: SupabaseClient = admin,
  ) =>
    core.publishPageCore(
      { pageId: site.owner.pageId, userId: site.owner.userId, ...(expected ? { expected } : {}) },
      { admin: client },
    );
  const conflict = { ok: false, errors: [], reason: "conflict" };
  /** A save by another writer: the draft changes and the rev moves on. */
  const save = async (id: string, blocks: unknown[]) => {
    const row = await tools.entry(id);
    const { error } = await admin
      .from("content_entries")
      .update({ draft: { ...row.draft, blocks } as never, rev: row.rev + 1 })
      .eq("id", id);
    if (error) throw new Error(error.message);
  };

  it("Publish all changes: a page saved after the gate's read is a conflict, and the older draft does not go live", async () => {
    const site = await tools.site("pc1", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Read")]);
    const expected = await held(site, [site.homeId, a]);
    const client = racing(admin, "publish_site", () =>
      save(a, [link("a-link-00001", "Saved since")]),
    );
    expect(await publishAll(site, expected, client)).toEqual(conflict);
    expect((await tools.entry(a)).published).toBeNull();
    expect((await tools.pageRow(site)).published).toBeNull();
  });

  it("Publish all changes: Home's blocks or the design saved after the read are a conflict too", async () => {
    const site = await tools.site("pc2", [link("home-link-001", "Read")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const viaHome = racing(admin, "publish_site", () =>
      save(site.homeId, [link("home-link-001", "Saved since")]),
    );
    expect(await publishAll(site, await held(site, [site.homeId, a]), viaHome)).toEqual(conflict);
    const viaDesign = racing(admin, "publish_site", () => tools.setDesign(site, { rev: 77 }));
    expect(await publishAll(site, await held(site, [site.homeId, a]), viaDesign)).toEqual(conflict);
    expect((await tools.pageRow(site)).published).toBeNull();
    expect((await tools.entry(site.homeId)).published).toBeNull();
  });

  it("Publish all changes without revs (MCP) still publishes what the gate read", async () => {
    const site = await tools.site("pc3", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001", "Read")]);
    const client = racing(admin, "publish_site", () =>
      save(a, [link("a-link-00001", "Saved since")]),
    );
    expect(await publishAll(site, undefined, client)).toMatchObject({ ok: true });
    expect((await tools.entry(a)).published!.blocks![0]!.label).toBe("Read");
  });

  it("Publish all changes: a page the editor does not hold (added elsewhere) is a conflict, with no rpc", async () => {
    const site = await tools.site("pc4", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const expected = await held(site, [site.homeId, a]);
    // Added through MCP or in another tab: this editor has never shown it.
    const unseen = await tools.sub(site, "Unseen", "unseen", [link("u-link-00001")]);
    const spy = recording(admin);
    expect(await publishAll(site, expected, spy.client)).toEqual(conflict);
    expect(wrote(spy.calls)).toEqual([]);
    expect((await tools.entry(unseen)).published).toBeNull();
    expect((await tools.pageRow(site)).published).toBeNull();
    // The same site through MCP's call, which holds no editor state, publishes everything.
    expect(await publishAll(site)).toMatchObject({ ok: true });
    expect((await tools.entry(unseen)).published).not.toBeNull();
  });

  it("Publish all changes sends the revs the editor holds to the function", async () => {
    const site = await tools.site("pc5", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const expected = await held(site, [site.homeId, a]);
    const spy = recording(admin);
    expect(await publishAll(site, expected, spy.client)).toMatchObject({ ok: true });
    expect(spy.args.publish_site).toMatchObject({
      p_expected_revs: { design: expected.designRev, entries: expected.entries },
    });
    // MCP's call sends none: the function then checks no rev.
    const mcp = recording(admin);
    expect(await publishAll(site, undefined, mcp.client)).toMatchObject({ ok: true });
    expect(mcp.args.publish_site).not.toHaveProperty("p_expected_revs");
  });

  it("Publish page: another page going live with the same block id meanwhile is refused, naming the block", async () => {
    const site = await tools.site("pc6", [link("home-link-001")], owners);
    const a = await tools.sub(site, "Items", "items", [link("a-link-00001")]);
    const b = await tools.sub(site, "About", "about", [link("b-link-00001")]);
    expect(await publishAll(site)).toMatchObject({ ok: true });
    // Both drafts now hold a block with the same id; neither is live with it yet.
    await save(a, [link("a-link-00001"), link("shared-id-001", "From A")]);
    await save(b, [link("b-link-00001"), link("shared-id-001", "From B")]);
    const one = (entryId: string, rev: number, client: SupabaseClient) =>
      core.publishSitePageCore(
        { pageId: site.owner.pageId, entryId, expectedRev: rev, userId: site.owner.userId },
        { admin: client },
      );
    // A passes every check of the gate (B's live copy has no such id), then B is published first.
    const client = racing(admin, "publish_site_page", async () => {
      expect(await one(b, (await tools.entry(b)).rev, admin)).toMatchObject({ ok: true });
    });
    const result = await one(a, (await tools.entry(a)).rev, client);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        blockId: "shared-id-001",
        field: "id",
        subPageId: a,
        pageTitle: "Items",
        message: expect.stringContaining(
          "This block shares its id with another block of the site. Remove it and add it again.",
        ),
      }),
    ]);
    const ids = (entry: Awaited<ReturnType<typeof tools.entry>>) =>
      (entry.published?.blocks ?? []).map((block) => block.id);
    expect(ids(await tools.entry(b))).toContain("shared-id-001");
    expect(ids(await tools.entry(a))).toEqual(["a-link-00001"]);
  });
});

describe("M15-12 a redirect whose target is not live is not served", () => {
  const doc = (blocks: unknown[], linkId: string) =>
    ({ redirect: { linkId }, blocks }) as unknown as PublishDoc;
  const live = link("lnk-target01", "Go", "https://example.com/go");

  it("redirects while the target is a live, visible link", () => {
    expect(redirectTargetId(doc([live], "lnk-target01"), "pro")).toBe("lnk-target01");
    const response = redirectModeResponse({
      pageId: "page-1",
      document: doc([live], "lnk-target01"),
      plan: "pro",
    });
    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/r/page-1/lnk-target01");
  });

  it("draws the page when the design names a block Home's live copy does not have", () => {
    // Publish design checked the target against Home's live blocks, and a Publish page of Home
    // without it won the race: the live document then names a link that is not there.
    const stale = doc([link("lnk-other001")], "lnk-target01");
    expect(redirectTargetId(stale, "pro")).toBeNull();
    expect(redirectModeResponse({ pageId: "page-1", document: stale, plan: "pro" })).toBeNull();
    expect(
      redirectModeResponse({ pageId: "page-1", document: doc([], "lnk-target01"), plan: "studio" }),
    ).toBeNull();
  });

  it("draws the page when the target is there but is no link any more, or is locked", () => {
    const header = { id: "lnk-target01", type: "header", visible: true, text: "Hi" };
    expect(redirectTargetId(doc([header], "lnk-target01"), "pro")).toBeNull();
    const locked = { ...live, lock: { kind: "code" } };
    expect(redirectTargetId(doc([locked], "lnk-target01"), "pro")).toBeNull();
  });
});
