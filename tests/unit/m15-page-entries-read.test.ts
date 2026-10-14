// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createEntryWithClient } from "@/lib/content/entries-core";
import { publishEntryWithClient } from "@/lib/content/publish-core";
import { trashEntryWithClient } from "@/lib/content/trash-core";
import {
  getHomeDraftWithClient,
  getLivePageWithClient,
  getPublishedHomeWithClient,
  listDraftPagesWithClient,
  listLivePagesWithClient,
} from "@/lib/site/page-entries";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage: vi.fn() }));

const { run } = await stackIsUp();
describe.skipIf(!run)("page entry reads", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];

  afterAll(async () => removeOwners(admin as never, owners));

  describe("on the seed (mara, moved)", () => {
    let siteId: string;
    beforeAll(async () => {
      const { data } = await admin.from("pages").select("id").eq("handle", "mara").single();
      siteId = data!.id;
    });

    it("live pages equal the pre-move site_pages index", async () => {
      const { data: old } = await admin
        .from("site_pages")
        .select("id, live_path, title:published->>title")
        .eq("page_id", siteId)
        .not("published", "is", null)
        .order("live_path", { ascending: true });
      const expected = (old ?? []).map((r) => ({
        id: r.id,
        path: r.live_path,
        title: r.title,
      }));
      expect(expected.length).toBeGreaterThan(0);
      expect(await listLivePagesWithClient(admin, siteId)).toEqual(expected);
    });

    it("the Home entry id never appears in the pages lists", async () => {
      const home = await getHomeDraftWithClient(admin, siteId);
      expect(home).not.toBeNull();
      expect(home!.draft.path).toBe("/");
      expect((await listLivePagesWithClient(admin, siteId)).map((p) => p.id)).not.toContain(
        home!.entryId,
      );
      expect((await listDraftPagesWithClient(admin, siteId)).map((p) => p.id)).not.toContain(
        home!.entryId,
      );
    });

    it("the published Home carries its entry id and blocks", async () => {
      const home = await getPublishedHomeWithClient(admin, siteId);
      expect(home).not.toBeNull();
      const draft = await getHomeDraftWithClient(admin, siteId);
      expect(home!.entryId).toBe(draft!.entryId);
      expect(Array.isArray((home!.published as { blocks: unknown[] }).blocks)).toBe(true);
      expect(home!.publishedAt).toEqual(expect.any(String));
    });

    it("draft pages list every non-Home entry with rev and live path", async () => {
      const { data: old } = await admin
        .from("site_pages")
        .select("id, live_path")
        .eq("page_id", siteId);
      const drafts = await listDraftPagesWithClient(admin, siteId);
      expect(drafts.map((d) => d.id).sort()).toEqual((old ?? []).map((r) => r.id).sort());
      for (const d of drafts) {
        expect(d.rev).toBeGreaterThanOrEqual(1);
        expect(d.createdAt).toEqual(expect.any(String));
      }
    });

    it("one live page by id, and not by a foreign site or the Home id", async () => {
      const live = await listLivePagesWithClient(admin, siteId);
      const one = await getLivePageWithClient(admin, siteId, live[0]!.id);
      expect(one?.id).toBe(live[0]!.id);
      expect((one!.published as { path: string }).path).toBe(live[0]!.path);
      const home = await getHomeDraftWithClient(admin, siteId);
      expect(await getLivePageWithClient(admin, siteId, home!.entryId)).toBeNull();
      const { data: other } = await admin.from("pages").select("id").neq("id", siteId).limit(1);
      expect(await getLivePageWithClient(admin, other![0]!.id, live[0]!.id)).toBeNull();
    });
  });

  describe("trash and drafts", () => {
    it("trashed entries are excluded", async () => {
      const o = await makeOwner(admin as never, "pe-a");
      owners.push(o);
      const actor = { userId: o.userId, source: "editor" as const };
      const page = (path: string, title: string) => ({ path, title, description: "", blocks: [] });
      const mk = async (path: string, title: string) => {
        const made = await createEntryWithClient(admin, {
          actor,
          siteId: o.pageId,
          typeKey: "page",
          draft: page(path, title),
        });
        if (!made.ok) throw new Error(`create failed: ${made.error}`);
        return made;
      };
      const a = await mk("alpha", "Alpha");
      const b = await mk("beta", "Beta");
      for (const e of [a, b]) {
        const r = await publishEntryWithClient(admin, {
          actor,
          entryId: e.id,
          expectedRev: e.rev,
        });
        if (!r.ok) throw new Error(`publish failed: ${r.error}`);
      }
      expect(await listLivePagesWithClient(admin, o.pageId)).toEqual([
        { id: a.id, path: "alpha", title: "Alpha" },
        { id: b.id, path: "beta", title: "Beta" },
      ]);
      expect(await listDraftPagesWithClient(admin, o.pageId)).toHaveLength(2);

      const row = (await admin.from("content_entries").select("rev").eq("id", b.id).single()).data!;
      const t = await trashEntryWithClient(admin, {
        actor,
        entryId: b.id,
        expectedRev: row.rev,
      });
      if (!t.ok) throw new Error(`trash failed: ${t.error}`);
      expect((await listLivePagesWithClient(admin, o.pageId)).map((p) => p.path)).toEqual([
        "alpha",
      ]);
      expect((await listDraftPagesWithClient(admin, o.pageId)).map((p) => p.id)).not.toContain(
        b.id,
      );
      expect(await getLivePageWithClient(admin, o.pageId, b.id)).toBeNull();
      expect(await getHomeDraftWithClient(admin, o.pageId)).toBeNull();
      expect(await getPublishedHomeWithClient(admin, o.pageId)).toBeNull();
    });
  });
});
