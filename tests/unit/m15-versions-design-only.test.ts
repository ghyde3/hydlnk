/* eslint-disable @typescript-eslint/no-explicit-any -- stored documents are JSON whose shape each test checks */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPublishForm, toSubPagePublishForm } from "@/lib/document";
import { RESTORE_SCOPE_NOTE, confirmQuestion, restoredMessage } from "@/lib/versions/messages";
import {
  draftOf,
  makeOwner,
  moveHome,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";
import { adminForTests } from "./support/mcp-db";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M15-10: History restores the site design only. A restore calls no entry writer and writes
 * `pages.draft` under its rev guard; Undo writes the design back and nothing else.
 */

// The three entry writers a restore used to call (M12-04, 1b1-21). They must never run again.
const writers = vi.hoisted(() => ({
  updateEntryWithClient: vi.fn(),
  createEntryWithClient: vi.fn(),
  restoreEntryWithClient: vi.fn(),
}));
vi.mock("@/lib/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content")>()),
  ...writers,
}));
vi.mock("@/lib/content/entries-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content/entries-core")>()),
  updateEntryWithClient: writers.updateEntryWithClient,
  createEntryWithClient: writers.createEntryWithClient,
}));
vi.mock("@/lib/content/trash-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content/trash-core")>()),
  restoreEntryWithClient: writers.restoreEntryWithClient,
}));

let admin: SupabaseClient;
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => admin }));

const { run } = await stackIsUp();
const dockerDb = (): boolean => {
  try {
    execFileSync("docker", ["exec", "supabase_db_hydlnk", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_hydlnk", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
    { input: sql, encoding: "utf8" },
  );
}
const link = (id: string, label: string) => ({
  id,
  type: "link" as const,
  visible: true,
  label,
  url: "https://example.com/a",
});

describe("M15-10 the restore core no longer reaches the entry writers (static)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/versions/core.ts"), "utf8");
  it("imports nothing from the content writer and names no entry write", () => {
    expect(source).not.toMatch(/from "@\/lib\/content"/);
    expect(source).not.toMatch(
      /updateEntryWithClient|createEntryWithClient|restoreEntryWithClient/,
    );
  });
  it("the browser Undo writes pages only: no entry save, no entry read", () => {
    const client = readFileSync(resolve(process.cwd(), "src/lib/versions/client.ts"), "utf8");
    expect(client).not.toMatch(/postEntryDraft|content_entries|createDraftSaver/);
  });
  it("the screen says what a restore brings back", () => {
    expect(RESTORE_SCOPE_NOTE).toBe(
      "Restores the design: theme, menu and profile. Pages are restored from their own revisions.",
    );
    expect(confirmQuestion(3)).toContain("Your pages don’t change");
    expect(restoredMessage(3, 0)).toContain("Restored the design of version 3");
    const screen = readFileSync(
      resolve(process.cwd(), "src/components/versions/history-screen.tsx"),
      "utf8",
    );
    expect(screen).toContain("RESTORE_SCOPE_NOTE");
  });
});

describe.skipIf(!run || !dockerDb())(
  "M15-10 History restores the design only (local Supabase)",
  () => {
    const owners: TestOwner[] = [];
    let core: typeof import("@/lib/versions/core");
    let client: typeof import("@/lib/versions/client");

    beforeAll(async () => {
      admin = adminForTests();
      core = await import("@/lib/versions/core");
      client = await import("@/lib/versions/client");
    });
    afterAll(async () => {
      await removeOwners(admin, owners);
    });
    beforeEach(() => {
      for (const writer of Object.values(writers)) writer.mockReset();
    });

    const entry = async (id: string) =>
      (
        await admin
          .from("content_entries")
          .select("id, rev, draft, published, deleted_at")
          .eq("id", id)
          .maybeSingle()
      ).data as any;
    const site = async (id: string) =>
      (await admin.from("pages").select("draft, published, published_at").eq("id", id).single())
        .data as any;

    /** A pro site with a moved Home and one sub-page; version 1 holds another design and other pages. */
    async function world(label: string) {
      const o = await makeOwner(admin, label, undefined, "pro");
      owners.push(o);
      const current = draftOf("Current", [link("home-link-001", "Current home")], {
        rev: 4,
        theme: { ref: null, overrides: { accent: "#112233" } },
      } as never);
      const set = await admin
        .from("pages")
        .update({ draft: current as never })
        .eq("id", o.pageId);
      if (set.error) throw new Error(set.error.message);
      const homeId = await moveHome(admin, o.pageId);
      const type = await admin
        .from("content_types")
        .select("id")
        .eq("site_id", o.pageId)
        .eq("key", "page")
        .single();
      const made = await admin
        .from("content_entries")
        .insert({
          site_id: o.pageId,
          type_id: type.data!.id,
          draft: {
            path: "about",
            title: "About now",
            description: "",
            blocks: [link("about-link-01", "Now")],
          } as never,
        })
        .select("id")
        .single();
      if (made.error) throw new Error(made.error.message);
      const aboutId = made.data.id as string;

      const doc = toPublishForm(
        draftOf("Restored", [link("home-link-001", "Old home")], {
          nav: { show: true, items: [aboutId] },
          theme: { ref: null, overrides: { accent: "#aa5500" } },
        } as never) as never,
        null,
      );
      const aboutDoc = toSubPagePublishForm({
        path: "about",
        title: "About then",
        description: "",
        blocks: [link("about-link-01", "Then")],
      } as never);
      const versionId = psql(
        `insert into public.page_versions (page_id, version_no, published_at, document, sub_pages)
       values ('${o.pageId}', 1, now(), $j$${JSON.stringify(doc)}$j$::jsonb,
               $j$${JSON.stringify([{ id: aboutId, published: aboutDoc }])}$j$::jsonb)
       returning id;`,
      )
        .split("\n")[0]!
        .trim();
      return { o, homeId, aboutId, versionId };
    }
    const restore = (w: { o: TestOwner; versionId: string }, client_: unknown = admin) =>
      core.restorePageVersionCore(
        { pageId: w.o.pageId, versionId: w.versionId, userId: w.o.userId },
        { admin: client_ as never, mediaExists: async () => true },
      );

    it("calls no entry writer and writes the version's design into pages.draft", async () => {
      const w = await world("vd1");
      const before = { home: await entry(w.homeId), about: await entry(w.aboutId) };
      const siteBefore = await site(w.o.pageId);

      const result = await restore(w);
      expect(result).toEqual({
        ok: true,
        restored: 1,
        missingImages: 0,
        pagesRestored: 0,
        recreated: 0,
        entries: [],
        notRestored: [],
      });
      expect(writers.updateEntryWithClient).not.toHaveBeenCalled();
      expect(writers.createEntryWithClient).not.toHaveBeenCalled();
      expect(writers.restoreEntryWithClient).not.toHaveBeenCalled();

      const after = await site(w.o.pageId);
      // The design is the version's: profile, theme and menu; rev one past; frozen blocks kept.
      expect(after.draft.profile.name).toBe("Restored");
      expect(after.draft.theme.overrides.accent).toBe("#aa5500");
      expect(after.draft.nav).toEqual({ show: true, items: [w.aboutId] });
      expect(after.draft.rev).toBe(5);
      expect(after.draft.blocks).toEqual(siteBefore.draft.blocks);
      // Nothing is published and both pages are exactly as they were.
      expect(after.published).toEqual(siteBefore.published);
      expect(after.published_at).toBe(siteBefore.published_at);
      expect(await entry(w.homeId)).toEqual(before.home);
      expect(await entry(w.aboutId)).toEqual(before.about);
    });

    /** The admin client, recording every draft sent to `pages` in an update. */
    const recordingPages = () => {
      const payloads: Record<string, unknown>[] = [];
      const spy = new Proxy(admin, {
        get(target, prop, receiver) {
          if (prop !== "from") return Reflect.get(target, prop, receiver);
          return (table: string) => {
            const builder = target.from(table);
            if (table !== "pages") return builder;
            return new Proxy(builder, {
              get(inner, key, self) {
                if (key !== "update") return Reflect.get(inner, key, self);
                return (payload: { draft?: Record<string, unknown> }, ...rest: unknown[]) => {
                  if (payload.draft) payloads.push(payload.draft);
                  return (inner.update as (...a: unknown[]) => unknown)(payload, ...rest);
                };
              },
            });
          };
        },
      });
      return { spy, payloads };
    };

    it("a moved site: the design write carries no blocks, and the database keeps the frozen copy", async () => {
      const w = await world("vd5");
      const siteBefore = await site(w.o.pageId);
      expect(siteBefore.draft.blocks).toHaveLength(1);
      const { spy, payloads } = recordingPages();
      expect(await restore(w, spy)).toMatchObject({ ok: true });
      // The frozen copy of a moved site is never read: nothing of it is sent back.
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).not.toHaveProperty("blocks");
      expect(payloads[0]).toMatchObject({ profile: { name: "Restored" }, rev: 5 });
      expect((await site(w.o.pageId)).draft.blocks).toEqual(siteBefore.draft.blocks);
    });

    it("a site with no Home entry keeps its blocks: they are in pages.draft and go back unchanged", async () => {
      // makeOwner alone gives the layout before the move: the site's blocks live in `pages.draft`.
      const o = await makeOwner(admin, "vd6", undefined, "pro");
      owners.push(o);
      const current = draftOf("Current", [link("home-link-001", "Only here")], { rev: 4 } as never);
      const set = await admin
        .from("pages")
        .update({ draft: current as never })
        .eq("id", o.pageId);
      if (set.error) throw new Error(set.error.message);
      const doc = toPublishForm(draftOf("Restored", [link("home-link-001", "Old")]) as never, null);
      const versionId = psql(
        `insert into public.page_versions (page_id, version_no, published_at, document, sub_pages)
       values ('${o.pageId}', 1, now(), $j$${JSON.stringify(doc)}$j$::jsonb, '[]'::jsonb) returning id;`,
      )
        .split("\n")[0]!
        .trim();
      const { spy, payloads } = recordingPages();
      expect(await restore({ o, versionId }, spy)).toMatchObject({ ok: true });
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toHaveProperty("blocks");
      const after = await site(o.pageId);
      expect(after.draft.profile.name).toBe("Restored");
      expect(after.draft.blocks).toEqual((current as any).blocks);
    });

    it("the write is guarded by the draft rev: a design saved meanwhile is a conflict, nothing written", async () => {
      const w = await world("vd2");
      const seen: { column: string; value: unknown }[] = [];
      let bumped = false;
      // Another tab saves the design after the restore read it, during its blocklist check.
      const racing = new Proxy(admin, {
        get(target, prop, receiver) {
          if (prop !== "rpc") return Reflect.get(target, prop, receiver);
          return async (...args: Parameters<typeof admin.rpc>) => {
            const out = await target.rpc(...args);
            if (!bumped) {
              bumped = true;
              const row = (await site(w.o.pageId)).draft;
              await target
                .from("pages")
                .update({ draft: { ...row, rev: row.rev + 1 } as never })
                .eq("id", w.o.pageId);
            }
            return out;
          };
        },
      });
      void seen;
      const result = await restore(w, racing);
      expect(bumped).toBe(true);
      expect(result).toEqual({ ok: false, reason: "conflict" });
      const after = (await site(w.o.pageId)).draft;
      expect(after.profile.name).toBe("Current");
      expect(after.rev).toBe(5);
      expect(writers.updateEntryWithClient).not.toHaveBeenCalled();
    });

    it("Undo writes the design back under the rev the restore left, and no page", async () => {
      const w = await world("vd3");
      const before = {
        design: (await site(w.o.pageId)).draft,
        home: await entry(w.homeId),
        about: await entry(w.aboutId),
      };
      const saved = await client.readDraft(w.o.pageId);
      expect(saved).toEqual({ draft: before.design });
      expect(await restore(w)).toMatchObject({ ok: true });
      expect((await site(w.o.pageId)).draft.theme.overrides.accent).toBe("#aa5500");

      expect(await client.undoRestore(w.o.pageId, saved!)).toBe("ok");
      const design = (await site(w.o.pageId)).draft;
      expect({ ...design, rev: 0 }).toEqual({ ...before.design, rev: 0 });
      expect(design.theme.overrides.accent).toBe("#112233");
      expect(design.rev).toBe(6);
      expect(await entry(w.homeId)).toEqual(before.home);
      expect(await entry(w.aboutId)).toEqual(before.about);
      // A second Undo finds the rev moved on: a conflict, nothing written.
      expect(await client.undoRestore(w.o.pageId, saved!)).toBe("conflict");
      expect((await site(w.o.pageId)).draft.rev).toBe(6);
    });
  },
);
