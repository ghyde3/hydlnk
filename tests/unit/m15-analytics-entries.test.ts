// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { stackIsUp } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

const { run } = await stackIsUp();
describe.skipIf(!run)("analytics on page entries (seed mara, moved)", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  let siteId: string;
  let ownerId: string;
  let homeEntryId: string;
  let subIds: string[];

  beforeAll(async () => {
    const { data } = await admin.from("pages").select("id, owner_id").eq("handle", "mara").single();
    siteId = data!.id;
    ownerId = data!.owner_id;
    const { getHomeDraftWithClient, listLivePagesWithClient } =
      await import("@/lib/site/page-entries");
    homeEntryId = (await getHomeDraftWithClient(admin, siteId))!.entryId;
    subIds = (await listLivePagesWithClient(admin, siteId)).map((p) => p.id);
  });

  it("the beacon accepts a moved sub-page id and not the Home entry id", async () => {
    const { lookupBeaconPage } = await import("@/lib/analytics/ingest/pages");
    const page = await lookupBeaconPage(siteId);
    expect(page).not.toBeNull();
    expect(subIds.length).toBeGreaterThan(0);
    expect([...(page!.subPageIds ?? [])].sort()).toEqual(subIds.map((i) => i.toLowerCase()).sort());
    expect(page!.subPageIds).not.toContain(homeEntryId.toLowerCase());
    expect(page!.handle).toBe("mara");
  });

  it("a link on Home resolves with subPageId undefined; one on a sub-page names its page", async () => {
    const { resolveClickTarget } = await import("@/lib/analytics/ingest/pages");
    const { getPublishedHomeWithClient } = await import("@/lib/site/page-entries");
    const home = await getPublishedHomeWithClient(admin, siteId);
    const homeLink = (
      home!.published as { blocks: { id: string; type: string; url?: string }[] }
    ).blocks.find((b) => b.type === "link" && typeof b.url === "string");
    expect(homeLink).toBeDefined();
    const homeTarget = await resolveClickTarget(siteId, homeLink!.id);
    expect(homeTarget).not.toBeNull();
    expect(homeTarget!.subPageId).toBeUndefined();

    const pairs = await admin.rpc("site_click_pairs", { p_page_id: siteId });
    const sub = (pairs.data ?? []).find((p) => p.sub_page_id !== null);
    expect(sub).toBeDefined();
    // The pairs name sub-pages only; Home's ids come from Home's document.
    expect((pairs.data ?? []).map((p) => p.sub_page_id)).not.toContain(homeEntryId);
    const subTarget = await resolveClickTarget(siteId, sub!.block_id);
    if (subTarget) expect(subTarget.subPageId).toBe(sub!.sub_page_id!.toLowerCase());
    expect(await resolveClickTarget(siteId, "no-such-block")).toBeNull();
  });

  it("the dashboard source reads Home's published state and labels from the entries", async () => {
    const { createAdminStatsSource } = await import("@/lib/analytics/dashboard/source");
    const page = await createAdminStatsSource(admin as unknown as SupabaseClient).resolvePage(
      ownerId,
      siteId,
    );
    expect(page).not.toBeNull();
    // Pre-move fixture: the frozen site_pages rows and the frozen Home blocks.
    const { data: old } = await admin
      .from("site_pages")
      .select("id, draft, published, live_path, created_at")
      .eq("page_id", siteId);
    const expected = (old ?? [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({
        id: r.id.toLowerCase(),
        title:
          (r.published as { title?: string } | null)?.title?.trim() ||
          (r.draft as { title?: string }).title?.trim() ||
          "Untitled page",
        live: r.live_path !== null,
      }));
    expect(
      (page!.subPages ?? []).map((s) => ({ id: s.id, title: s.title, live: s.published !== null })),
    ).toEqual(expected);
    expect(page!.subPages!.map((s) => s.id)).not.toContain(homeEntryId.toLowerCase());

    const { data: frozen } = await admin
      .from("pages")
      .select("published")
      .eq("id", siteId)
      .single();
    const { getPublishedHomeWithClient } = await import("@/lib/site/page-entries");
    const home = await getPublishedHomeWithClient(admin, siteId);
    const published = page!.published as { blocks: unknown };
    expect(published.blocks).toEqual((home!.published as { blocks: unknown }).blocks);
    expect(published.blocks).toEqual((frozen!.published as { blocks: unknown }).blocks);
  });

  it("a site whose Home entry is unpublished reads as unpublished to the dashboard", async () => {
    const { createAdminStatsSource } = await import("@/lib/analytics/dashboard/source");
    const source = createAdminStatsSource(admin as unknown as SupabaseClient);
    // A foreign owner never sees the page.
    expect(await source.resolvePage("00000000-0000-4000-8000-000000000000", siteId)).toBeNull();
  });
});
