// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- stored documents are JSON whose shape each test checks */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import {
  draftOf,
  makeOwner,
  moveHome,
  rand,
  removeOwners,
  setPageDraft,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const mocks = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => mocks.client }));

const { run } = await stackIsUp();

/**
 * Second review of the stage 1b-1 cutover: a new site has a Home entry and publishes; the editor's
 * published copy is merged with Home's entry; Home's '/' path is pinned.
 */
describe.skipIf(!run)("cutover review 2 (local Supabase)", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];
  afterAll(async () => {
    if (run) await removeOwners(admin as never, owners);
  });

  const link = (id: string, label: string) => ({
    id,
    type: "link" as const,
    visible: true,
    label,
    url: "https://example.com/a",
  });
  const publish = async (o: TestOwner) => {
    const { publishPageCore } = await import("@/lib/publish/core");
    return publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin: admin as never });
  };
  const homeEntry = async (siteId: string) =>
    (
      await admin
        .from("content_entries")
        .select("id, rev, draft, published, deleted_at")
        .eq("site_id", siteId)
        .eq("draft->>path", "/")
        .maybeSingle()
    ).data as any;

  async function session(o: TestOwner) {
    const l = await admin.auth.admin.generateLink({ type: "magiclink", email: o.email });
    if (l.error) throw new Error(l.error.message);
    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    const v = await client.auth.verifyOtp({
      token_hash: l.data.properties.hashed_token,
      type: "magiclink",
    });
    if (v.error) throw new Error(v.error.message);
    return client;
  }

  describe("a site made through the claim", () => {
    it("has its Home entry at once, and publishes", async () => {
      const { claimHandleWithClient } = await import("@/lib/handles/claim-core");
      const created = await admin.auth.admin.createUser({
        email: `zq-cl-${rand()}@example.com`,
        email_confirm: true,
      });
      const userId = created.data.user!.id;
      const handle = `zq-cl-${rand()}`;
      owners.push({ userId, email: "", pageId: "", handle });
      const claimed = await claimHandleWithClient(admin as never, userId, handle);
      if (!claimed.ok) throw new Error(claimed.error);
      const home = await homeEntry(claimed.pageId);
      expect(home).not.toBeNull();
      expect(home.draft).toMatchObject({ path: "/", blocks: [] });

      // A save shaped like the editor's: the design to pages.draft, the blocks to Home's entry.
      const saved = await setPageDraft(
        admin as never,
        claimed.pageId,
        draftOf(handle, [link("lnk-claim-01", "Claimed")]),
      );
      expect(saved.error).toBeNull();
      expect(await publish({ userId, email: "", pageId: claimed.pageId, handle })).toMatchObject({
        ok: true,
      });
      expect((await homeEntry(claimed.pageId)).published.blocks[0].label).toBe("Claimed");
    });

    it("publishes even when its Home entry was never made (the first publish moves it)", async () => {
      const o = await makeOwner(admin as never, "cl0", (h) => draftOf(h));
      owners.push(o);
      expect(await homeEntry(o.pageId)).toBeNull();
      expect(await publish(o)).toMatchObject({ ok: true });
      const home = await homeEntry(o.pageId);
      expect(home.published).not.toBeNull();
    });
  });

  describe("the editor's published copy", () => {
    it("carries Home's published blocks, so a published site is not 'Unpublished changes'", async () => {
      const o = await makeOwner(admin as never, "pub", (h) => draftOf(h, [link("lnk-pub-0001", "One")]));
      owners.push(o);
      await moveHome(admin as never, o.pageId);
      expect(await publish(o)).toMatchObject({ ok: true });

      const { saveEntryDraftWithClient } = await import("@/lib/site-pages/entry-save-core");
      const home = await homeEntry(o.pageId);
      const out = await saveEntryDraftWithClient(admin as never, {
        userId: o.userId,
        siteId: o.pageId,
        entryId: home.id,
        expectedRev: Number(home.rev),
        draft: { path: "/", title: "", description: "", blocks: [link("lnk-pub-0001", "Two")] },
      });
      expect(out.body.kind).toBe("ok");
      expect(await publish(o)).toMatchObject({ ok: true });

      mocks.client = await session(o);
      const { loadEditorPageData } = await import("@/lib/editor/page-data");
      const { computePublishStatus } = await import("@/lib/editor/status");
      const { toPublishForm } = await import("@/lib/document");
      const data = await loadEditorPageData({ id: o.pageId, handle: o.handle }, o.userId);
      expect((data.published as any).blocks[0].label).toBe("Two");
      expect(
        computePublishStatus({
          hasPublished: data.hasPublished,
          published: data.published,
          form: toPublishForm(data.draft, data.themeTokens),
        }),
      ).toBe("published");
    });
  });

  describe("Home's path is pinned", () => {
    it("the save route refuses a non-'/' path for Home, and Home cannot be deleted as a sub-page", async () => {
      const o = await makeOwner(admin as never, "pin", (h) => draftOf(h), "pro");
      owners.push(o);
      const homeId = await moveHome(admin as never, o.pageId);
      expect(await publish(o)).toMatchObject({ ok: true });
      const { saveEntryDraftWithClient } = await import("@/lib/site-pages/entry-save-core");
      const home = await homeEntry(o.pageId);
      const out = await saveEntryDraftWithClient(admin as never, {
        userId: o.userId,
        siteId: o.pageId,
        entryId: homeId,
        expectedRev: Number(home.rev),
        draft: { path: "about", title: "About", description: "", blocks: [] },
      });
      expect(out.body.kind).toBe("path");
      expect((await homeEntry(o.pageId)).draft.path).toBe("/");
      expect(await publish(o)).toMatchObject({ ok: true });

      const { deleteSubPageWithClient } = await import("@/lib/site-pages/sub-pages-core");
      const del = await deleteSubPageWithClient(admin as never, {
        userId: o.userId,
        siteId: o.pageId,
        subPageId: homeId,
      });
      expect(del.ok).toBe(false);
      const trash = await admin.rpc("trash_entry", {
        p_entry_id: homeId,
        p_owner_id: o.userId,
        p_expected_rev: Number((await homeEntry(o.pageId)).rev),
      });
      expect(trash.error?.code).toBe("HL012");
      expect((await homeEntry(o.pageId)).deleted_at).toBeNull();
    });
  });
});

/** The sub-page saver and the Home saver speak the entry route's whole vocabulary. */
describe("the entry save client maps path and suspended answers", () => {
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  afterEach(() => vi.unstubAllGlobals());

  it("a path answer is terminal for a sub-page, not a generic retried error", async () => {
    answer(409, { kind: "path", message: "That address is already used or reserved." });
    // The browser client reads the public env at import; CI has no .env.local.
    vi.doMock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({}) }));
    const { createSubPageSaveFn, createSubPageRevisions } = await import(
      "@/lib/site-pages/save-client"
    );
    const save = createSubPageSaveFn(createSubPageRevisions({ a: 3 }), "site");
    const { emptySubPageDraft } = await import("@/lib/document");
    expect(await save("a", emptySubPageDraft("menu", "Menu"))).toEqual({ kind: "invalid" });
  });

  it("a suspension answer stops the queue like a lost session", async () => {
    answer(403, { kind: "suspended", code: "x", message: "Suspended" });
    // The browser client reads the public env at import; CI has no .env.local.
    vi.doMock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({}) }));
    const { createSubPageSaveFn, createSubPageRevisions } = await import(
      "@/lib/site-pages/save-client"
    );
    const save = createSubPageSaveFn(createSubPageRevisions({ a: 3 }), "site");
    const { emptySubPageDraft } = await import("@/lib/document");
    expect(await save("a", emptySubPageDraft("menu", "Menu"))).toEqual({ kind: "unauthorized" });
  });

  it("the queue flags an 'invalid' page and does not retry it on a timer", async () => {
    vi.useFakeTimers();
    const { SubPageSaver } = await import("@/lib/site-pages/saver");
    const { emptySubPageDraft } = await import("@/lib/document");
    const save = vi.fn(async () => ({ kind: "invalid" }) as const);
    const statuses: string[] = [];
    const saver = new SubPageSaver({ save, onStatus: (s) => statuses.push(s) });
    saver.schedule("a", emptySubPageDraft("menu", "Menu"));
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("invalid");
    saver.dispose();
    vi.useRealTimers();
  });

  it("Home's saver maps them too", async () => {
    answer(403, { kind: "suspended", code: "x", message: "Suspended" });
    vi.doMock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({}) }));
    const { createDraftSaver } = await import("@/lib/editor/save-client");
    const save = createDraftSaver("site", { entryId: "e", rev: 1 });
    const doc = draftOf("A", [
      { id: "lnk-x-0001", type: "link", visible: true, label: "x", url: "https://example.com" },
    ]);
    expect(await save(doc, "1")).toEqual({ kind: "unauthorized" });
  });
});
