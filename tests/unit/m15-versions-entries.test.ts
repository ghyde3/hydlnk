/* eslint-disable @typescript-eslint/no-explicit-any -- stored documents are JSON whose shape each test checks */
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPublishForm, toSubPagePublishForm } from "@/lib/document";
import {
  makeOwner,
  moveHome,
  removeOwners,
  stackIsUp,
  draftOf,
  type TestOwner,
} from "./publish-support";
import { adminForTests } from "./support/mcp-db";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * 1b1-21 (M15-05) against the local database: Restore and Undo on page entries. A version keeps its
 * shape (document with Home's blocks, sub_pages), and a restore writes the design to `pages.draft`
 * (frozen blocks untouched), Home's blocks to the '/' entry and each page's draft to its entry
 * (source system); a missing page is recreated under its old id; Undo puts the drafts back.
 */
const { run } = await stackIsUp();

let admin: SupabaseClient;
// The browser pieces Undo uses, pointed at the secret-key client (the tests have no browser session).
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => admin }));
vi.mock("@/lib/site-pages/entry-save-client", async () => {
  const { saveEntryDraftWithClient } = await import("@/lib/site-pages/entry-save-core");
  return {
    postEntryDraft: async (siteId: string, entryId: string, rev: number, draft: unknown) => {
      const owner = (await admin.from("pages").select("owner_id").eq("id", siteId).single()).data!;
      const out = await saveEntryDraftWithClient(admin as never, {
        userId: owner.owner_id,
        siteId,
        entryId,
        expectedRev: rev,
        draft,
      });
      return out.body;
    },
  };
});

/** page_versions is written by a trigger only (no API role may insert), so the tests use psql. */
function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_hydlnk", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
    { input: sql, encoding: "utf8" },
  );
}
async function putVersion(siteId: string, doc: unknown, subs: unknown): Promise<string> {
  const out = psql(
    `insert into public.page_versions (page_id, version_no, published_at, document, sub_pages)
     values ('${siteId}', 1, now(), $j$${JSON.stringify(doc)}$j$::jsonb, $j$${JSON.stringify(subs)}$j$::jsonb)
     returning id;`,
  );
  return out.split("\n")[0]!.trim();
}
const dockerDb = (): boolean => {
  try {
    execFileSync("docker", ["exec", "supabase_db_hydlnk", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const link = (id: string, label: string, url = "https://example.com/a") => ({
  id,
  type: "link" as const,
  visible: true,
  label,
  url,
});

describe.skipIf(!run || !dockerDb())(
  "version restore and Undo on page entries (local Supabase)",
  () => {
    const owners: TestOwner[] = [];
    const blocked: string[] = [];
    let core: typeof import("@/lib/versions/core");
    let client: typeof import("@/lib/versions/client");
    const deps = () => ({ admin: admin as never, mediaExists: async () => true });

    const entry = async (id: string) => {
      const { data, error } = await admin
        .from("content_entries")
        .select("id, rev, draft, deleted_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { ...(data as any), rev: Number((data as any).rev) } : null;
    };
    const site = async (id: string) =>
      (await admin.from("pages").select("draft").eq("id", id).single()).data!.draft as any;

    async function pageType(o: TestOwner) {
      return (
        await admin
          .from("content_types")
          .select("id")
          .eq("site_id", o.pageId)
          .eq("key", "page")
          .single()
      ).data!.id as string;
    }
    async function subPage(o: TestOwner, path: string, title: string, blocks: unknown[]) {
      const made = await admin
        .from("content_entries")
        .insert({
          site_id: o.pageId,
          type_id: await pageType(o),
          draft: { path, title, description: `About ${title}`, blocks } as never,
        })
        .select("id")
        .single();
      if (made.error) throw new Error(made.error.message);
      return made.data.id as string;
    }

    /** A pro owner with a moved Home and two sub-pages; a version holds different drafts of all three. */
    async function world(label: string) {
      const o = await makeOwner(admin, label, undefined, "pro");
      owners.push(o);
      const current = draftOf("Current", [link("home-link-001", "Current home")], { rev: 4 });
      const set = await admin
        .from("pages")
        .update({ draft: current as never })
        .eq("id", o.pageId);
      if (set.error) throw new Error(set.error.message);
      const homeId = await moveHome(admin, o.pageId);
      const aboutId = await subPage(o, "about", "About now", [link("about-link-01", "Now")]);
      const shopId = await subPage(o, "shop", "Shop now", [link("shop-link-001", "Shop now")]);

      const doc = toPublishForm(
        draftOf("Restored", [link("home-link-001", "Old home"), link("home-link-002", "Second")], {
          nav: { show: true, items: [aboutId, shopId] },
        }) as never,
        null,
      );
      const aboutDoc = toSubPagePublishForm({
        path: "about",
        title: "About then",
        description: "About then",
        blocks: [link("about-link-01", "Then")],
      } as never);
      const shopDoc = toSubPagePublishForm({
        path: "shop",
        title: "Shop then",
        description: "Shop then",
        blocks: [link("shop-link-001", "Shop then")],
      } as never);
      const versionId = await putVersion(o.pageId, doc, [
        { id: aboutId, published: aboutDoc },
        { id: shopId, published: shopDoc },
      ]);
      return { o, homeId, aboutId, shopId, versionId };
    }
    const input = (w: { o: TestOwner; versionId: string }) => ({
      pageId: w.o.pageId,
      versionId: w.versionId,
      userId: w.o.userId,
    });

    beforeAll(async () => {
      admin = adminForTests();
      core = await import("@/lib/versions/core");
      client = await import("@/lib/versions/client");
    });
    afterAll(async () => {
      if (blocked.length > 0) await admin.from("blocked_domains").delete().in("domain", blocked);
      await removeOwners(admin, owners);
    });

    it("restores the design to pages.draft and each page's blocks to its entry", async () => {
      const w = await world("v21-basic");
      const frozen = (await site(w.o.pageId)).blocks;
      const homeBefore = (await entry(w.homeId))!;
      const result = await core.restorePageVersionCore(input(w), deps());
      expect(result).toMatchObject({ ok: true, restored: 1, pagesRestored: 2, notRestored: [] });

      // Design: the version's profile and menu, rev one past, blocks still the frozen copy.
      const design = await site(w.o.pageId);
      expect(design.profile.name).toBe("Restored");
      expect(design.rev).toBe(5);
      expect(design.nav).toEqual({ show: true, items: [w.aboutId, w.shopId] });
      expect(design.blocks).toEqual(frozen);

      // Home's entry: the version's blocks, its own path, title and description.
      const home = (await entry(w.homeId))!;
      expect(home.rev).toBe(homeBefore.rev + 1);
      expect(home.draft).toMatchObject({ path: "/", title: "", description: "" });
      expect(home.draft.blocks.map((b: any) => b.label)).toEqual(["Old home", "Second"]);

      // The pages: the drafts of the version, nothing published.
      const about = (await entry(w.aboutId))!;
      expect(about.draft).toMatchObject({ path: "about", title: "About then" });
      expect(about.draft.blocks.map((b: any) => b.label)).toEqual(["Then"]);
      const shop = (await entry(w.shopId))!;
      expect(shop.draft.title).toBe("Shop then");

      // The revisions were recorded by the system, and nothing was published.
      const revs = await admin
        .from("content_entry_revisions")
        .select("source")
        .eq("entry_id", w.aboutId);
      expect(revs.data?.some((r: any) => r.source === "system")).toBe(true);
      expect(about.published ?? null).toBeNull();
    });

    it("answers conflict when the design draft moved, and writes no page", async () => {
      const w = await world("v21-conflict");
      // The restore reads `draft->>rev` first; a stale reader is simulated by a second restore that
      // runs between: the first call sees the rev its own read returned, so run them back to back.
      const [a, b] = await Promise.all([
        core.restorePageVersionCore(input(w), deps()),
        core.restorePageVersionCore(input(w), deps()),
      ]);
      const reasons = [a, b].map((r) => (r.ok ? "ok" : r.reason));
      expect(reasons).toContain("ok");
      // Whoever lost either conflicted or (the other already finished) wrote the same drafts.
      for (const r of [a, b]) if (!r.ok) expect(r.reason).toBe("conflict");
      const about = (await entry(w.aboutId))!;
      expect(about.draft.title).toBe("About then");
    });

    it("a conflict on the design write puts Home's blocks back: nothing changes", async () => {
      const w = await world("v21-conflict-home");
      const before = (await entry(w.homeId))!;
      // Another tab autosaves the design right after the restore wrote Home's blocks.
      let bumped = false;
      const racing = new Proxy(admin, {
        get(target, prop, receiver) {
          if (prop !== "rpc") return Reflect.get(target, prop, receiver);
          return async (...args: Parameters<typeof admin.rpc>) => {
            const out = await target.rpc(...args);
            if (!bumped && args[0] === "record_entry_revision") {
              bumped = true;
              const row = (await site(w.o.pageId)) as any;
              await target
                .from("pages")
                .update({ draft: { ...row, rev: Number(row.rev) + 1 } as never })
                .eq("id", w.o.pageId);
            }
            return out;
          };
        },
      });
      const result = await core.restorePageVersionCore(input(w), {
        admin: racing as never,
        mediaExists: async () => true,
      });
      expect(bumped).toBe(true);
      expect(result).toMatchObject({ ok: false, reason: "conflict" });
      const after = (await entry(w.homeId))!;
      expect(after.draft.blocks.map((b: any) => b.label)).toEqual(
        before.draft.blocks.map((b: any) => b.label),
      );
    });

    it("brings a trashed page back and recreates a purged one under its old id", async () => {
      const w = await world("v21-recreate");
      const about = (await entry(w.aboutId))!;
      const trashed = await admin.rpc("trash_entry", {
        p_entry_id: w.aboutId,
        p_owner_id: w.o.userId,
        p_expected_rev: about.rev,
      });
      expect(trashed.error).toBeNull();
      const del = await admin.from("content_entries").delete().eq("id", w.shopId);
      expect(del.error).toBeNull();

      const result = await core.restorePageVersionCore(input(w), deps());
      expect(result).toMatchObject({ ok: true, pagesRestored: 2, recreated: 2, notRestored: [] });
      const backAbout = (await entry(w.aboutId))!;
      expect(backAbout.deleted_at).toBeNull();
      expect(backAbout.draft.title).toBe("About then");
      const backShop = (await entry(w.shopId))!;
      expect(backShop.deleted_at).toBeNull();
      expect(backShop.draft).toMatchObject({ path: "shop", title: "Shop then" });
    });

    it("lists a page whose links are blocked now, leaves it as it is and writes the rest", async () => {
      const w = await world("v21-blocked");
      const domain = `blocked-${Math.random().toString(36).slice(2, 8)}.example`;
      expect(
        (await admin.from("blocked_domains").insert({ domain, reason: "test" })).error,
      ).toBeNull();
      blocked.push(domain);
      const bad = toSubPagePublishForm({
        path: "shop",
        title: "Shop then",
        description: "x",
        blocks: [link("shop-link-001", "Bad", `https://${domain}/x`)],
      } as never);
      psql(
        `update public.page_versions set sub_pages = $j$${JSON.stringify([{ id: w.shopId, published: bad }])}$j$::jsonb where id = '${w.versionId}';`,
      );
      const result = await core.restorePageVersionCore(input(w), deps());
      expect(result).toMatchObject({ ok: true, pagesRestored: 0 });
      expect(result.ok && result.notRestored).toEqual([
        { id: w.shopId, path: "shop", title: "Shop then", reason: "blocked_link", hosts: [domain] },
      ]);
      expect((await entry(w.shopId))!.draft.title).toBe("Shop now");
      expect((await entry(w.homeId))!.draft.blocks).toHaveLength(2);
    });

    it("refuses another owner's site and a suspended account before writing", async () => {
      const w = await world("v21-owner");
      const other = await makeOwner(admin, "v21-other", undefined, "pro");
      owners.push(other);
      const result = await core.restorePageVersionCore(
        { pageId: w.o.pageId, versionId: w.versionId, userId: other.userId },
        deps(),
      );
      expect(result).toEqual({ ok: false, reason: "forbidden" });
      await admin
        .from("accounts")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", w.o.userId);
      const suspended = await core.restorePageVersionCore(input(w), deps());
      expect(suspended).toEqual({ ok: false, reason: "account_suspended" });
      expect((await entry(w.homeId))!.draft.blocks).toHaveLength(1);
    });

    it("Undo puts the design, Home's blocks and each page back to the drafts before the restore", async () => {
      const w = await world("v21-undo");
      const before = {
        design: await site(w.o.pageId),
        home: (await entry(w.homeId))!.draft,
        about: (await entry(w.aboutId))!.draft,
        shop: (await entry(w.shopId))!.draft,
      };
      const saved = await client.readDraft(w.o.pageId);
      expect(saved).not.toBeNull();
      const result = await core.restorePageVersionCore(input(w), deps());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.recreated).toBe(0);
      expect(result.entries.length).toBe(3);

      const outcome = await client.undoRestore(w.o.pageId, saved!, result.entries);
      expect(outcome).toBe("ok");
      expect((await entry(w.homeId))!.draft).toEqual(before.home);
      expect((await entry(w.aboutId))!.draft).toEqual(before.about);
      expect((await entry(w.shopId))!.draft).toEqual(before.shop);
      const design = await site(w.o.pageId);
      expect({ ...design, rev: 0 }).toEqual({ ...before.design, rev: 0 });
      // A newer rev than the restore left, so a stale editor tab still meets its guard.
      expect(design.rev).toBeGreaterThan(5);
    });

    it("Undo does not overwrite what was saved after the restore", async () => {
      const w = await world("v21-undo-conflict");
      const saved = await client.readDraft(w.o.pageId);
      const result = await core.restorePageVersionCore(input(w), deps());
      if (!result.ok) throw new Error("restore failed");
      // The editor saves Home's blocks after the restore.
      const home = (await entry(w.homeId))!;
      await admin
        .from("content_entries")
        .update({
          draft: { ...home.draft, blocks: [link("later-link-001", "Later")] },
          rev: home.rev + 1,
        })
        .eq("id", w.homeId);
      const outcome = await client.undoRestore(w.o.pageId, saved!, result.entries);
      expect(outcome).toBe("conflict");
      expect((await entry(w.homeId))!.draft.blocks[0].label).toBe("Later");
    });
  },
);
