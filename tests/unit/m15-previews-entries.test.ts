// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { draftSubPageSchema, toPublishForm, toSubPagePublishForm } from "@/lib/document";
import { loadDraft } from "@/lib/editor/load";
import { sanitizeSharedDoc } from "@/lib/previews/sanitize";
import { generatePreviewToken, hashPreviewToken } from "@/lib/previews/token";
import type { Database, Json } from "@/lib/supabase/database.types";
import { stackIsUp } from "./publish-support";

vi.mock("server-only", () => ({}));

const { run } = await stackIsUp();

/**
 * 1b1-14 (M15-05): share links, the admin draft view and the admin account view read page entries.
 * The frozen pre-move copies (pages.draft's blocks and the site_pages rows, untouched by the
 * copy-only move) are the fixtures: what the old code drew from them equals what the entries give.
 */
describe.skipIf(!run)("previews and admin views on page entries (seed mara)", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  let siteId: string;
  let token: string;
  let frozenHome: ReturnType<typeof loadDraft>["draft"];
  let frozenSubs: { id: string; draft: unknown }[];

  beforeAll(async () => {
    const { data: page } = await admin
      .from("pages")
      .select("id, handle, draft")
      .eq("handle", "mara")
      .single();
    siteId = page!.id;
    frozenHome = loadDraft(page!.draft, "mara").draft;
    const { data: rows } = await admin
      .from("site_pages")
      .select("id, draft")
      .eq("page_id", siteId)
      .order("created_at", { ascending: true });
    frozenSubs = rows!;
    expect(frozenSubs.length).toBeGreaterThan(0);
    token = generatePreviewToken();
    const made = await admin
      .from("preview_links")
      .insert({ page_id: siteId, token_hash: hashPreviewToken(token) });
    if (made.error) throw new Error(made.error.message);
  });

  afterAll(async () => {
    if (run) await admin.from("preview_links").delete().eq("token_hash", hashPreviewToken(token));
  });

  it("the shared draft of Home equals the pre-move draft", async () => {
    const { loadSharedPreview } = await import("@/lib/previews/shared");
    const result = await loadSharedPreview(admin, token);
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;
    expect(result.doc.blocks).toEqual(sanitizeSharedDoc(toPublishForm(frozenHome, null)).blocks);
  });

  it("the shared draft of each sub-page equals the pre-move draft, and an unknown path is inactive", async () => {
    const { loadSharedPreview } = await import("@/lib/previews/shared");
    for (const frozen of frozenSubs) {
      const parsed = draftSubPageSchema.parse(frozen.draft);
      const expected = toSubPagePublishForm(parsed);
      const result = await loadSharedPreview(admin, token, new Date(), parsed.path);
      expect(result.kind, parsed.path).toBe("active");
      if (result.kind !== "active") continue;
      expect(result.subPage!.title).toBe(expected.title);
      expect(result.subPage!.blocks).toEqual(
        sanitizeSharedDoc({ ...result.doc, blocks: expected.blocks }).blocks,
      );
      // Entry ids equal the old site_pages ids, so menu targets keep resolving.
      expect(Object.keys(result.site!.hrefs)).toContain(frozen.id);
    }
    expect((await loadSharedPreview(admin, token, new Date(), "no-such-page")).kind).toBe(
      "inactive",
    );
  });

  it("reads entries, not the frozen copies: an entry edit shows, and a trashed page is gone", async () => {
    const { loadSharedPreview } = await import("@/lib/previews/shared");
    const { data: entries } = await admin
      .from("content_entries")
      .select("id, draft, deleted_at")
      .eq("site_id", siteId);
    const sub =
      entries!.find((e) => (e.draft as { path?: string }).path === "about") ??
      entries!.find((e) => (e.draft as { path?: string }).path !== "/")!;
    const subPath = (sub.draft as { path: string }).path;
    const home = entries!.find((e) => (e.draft as { path?: string }).path === "/")!;
    const edit = (doc: unknown, field: string, value: unknown): Json =>
      ({ ...(doc as Record<string, unknown>), [field]: value }) as Json;
    try {
      await admin
        .from("content_entries")
        .update({ draft: edit(sub.draft, "title", "Entry only title") })
        .eq("id", sub.id);
      const viewed = await loadSharedPreview(admin, token, new Date(), subPath);
      expect(viewed.kind === "active" && viewed.subPage?.title).toBe("Entry only title");

      await admin
        .from("content_entries")
        .update({ draft: edit(home.draft, "blocks", []) })
        .eq("id", home.id);
      const emptied = await loadSharedPreview(admin, token);
      expect(emptied.kind === "active" && emptied.doc.blocks).toEqual([]);

      await admin
        .from("content_entries")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", sub.id);
      expect((await loadSharedPreview(admin, token, new Date(), subPath)).kind).toBe("inactive");
    } finally {
      await admin
        .from("content_entries")
        .update({ draft: sub.draft as Json, deleted_at: null })
        .eq("id", sub.id);
      await admin
        .from("content_entries")
        .update({ draft: home.draft as Json })
        .eq("id", home.id);
    }
  });

  it("the admin draft view lists the entries' pages and draws Home from the entry", async () => {
    const { loadAdminDraftView } = await import("@/lib/admin/draft-view");
    const view = await loadAdminDraftView(admin, siteId, "");
    expect(view.kind).toBe("active");
    if (view.kind !== "active") return;
    const expected = frozenSubs.map((s) => draftSubPageSchema.parse(s.draft).path).sort();
    expect(view.pages.map((p) => p.path).sort()).toEqual(expected);
    expect(view.preview.doc.blocks).toEqual(
      sanitizeSharedDoc(toPublishForm(frozenHome, null)).blocks,
    );
  });

  it("the admin account view lists the sub-pages from entries with the old ids and live state", async () => {
    const { getAccountDetail } = await import("@/lib/admin/account-queries");
    const { data: owner } = await admin.from("pages").select("owner_id").eq("id", siteId).single();
    const detail = await getAccountDetail(owner!.owner_id, admin);
    const site = detail!.sites.find((s) => s.pageId === siteId)!;
    const { data: old } = await admin
      .from("site_pages")
      .select("id, published_at")
      .eq("page_id", siteId);
    expect(site.subPages.map((s) => s.id).sort()).toEqual(old!.map((s) => s.id).sort());
    for (const sub of site.subPages) {
      const was = old!.find((o) => o.id === sub.id)!;
      expect(sub.live).toBe(was.published_at !== null);
    }
  });
});
