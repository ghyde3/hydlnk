// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockDefaults, publishedDocSchema, type Block, type FormBlock } from "@/lib/document";
import { resolveTokens } from "@/lib/theme";
import { seedFormRows } from "../../scripts/lib/local-db";
import {
  makeOwner,
  moveHome,
  removeOwners,
  setPageDraft,
  stackIsUp,
  type TestOwner,
} from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";

vi.mock("server-only", () => ({}));

/**
 * The Audience loaders against the local stack (the real queries, the secret-key client standing in
 * for the owner's session; RLS is pinned in m17f-forms-rls.test.ts and pgTAP 219):
 *   * review B10 / M17-08: a form's label comes from the published document, then the draft, then
 *     "Removed form";
 *   * review B6 / M17-08: `?page=` past the last page shows the last page (after the last row of
 *     page 2 is deleted, page 2 shows page 1), never the load-failure card;
 *   * M17-09: the export is newest first and at most the newest N rows (the real loader with a
 *     smaller N and page size, not a stub of the loader).
 */
const { run } = await stackIsUp();

const LIVE: FormBlock = {
  ...(blockDefaults.form() as FormBlock),
  id: "formLiveLbl1",
  heading: "Live list",
};
const NEXT: FormBlock = {
  ...(blockDefaults.form() as FormBlock),
  id: "formNextLbl1",
  heading: "Next list",
};

function publishDoc(blocks: Block[]) {
  return publishedDocSchema.parse({
    version: 1,
    profile: { name: "Audience", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: resolveTokens(null),
    blocks,
  });
}

describe.skipIf(!run)("M17-08 / M17-09 the Audience loaders (local Supabase)", () => {
  let admin: SupabaseClient;
  let audience: typeof import("@/lib/forms/audience");
  let contract: typeof import("@/lib/forms/contract");
  const owners: TestOwner[] = [];
  const usage = async () => ({
    stored: 0,
    refused: 0,
    refusedDaily: 0,
    notifySkippedToday: 0,
    limit: 100,
  });

  beforeAll(async () => {
    admin = adminClient();
    audience = await import("@/lib/forms/audience");
    contract = await import("@/lib/forms/contract");
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  async function owner(label: string): Promise<TestOwner> {
    const made = await makeOwner(admin, label);
    owners.push(made);
    await moveHome(admin, made.pageId);
    return made;
  }

  it("a form removed in the draft but still live keeps its live label; a draft-only form has its draft label; others read Removed form", async () => {
    const o = await owner("faud-lbl");
    const published = await admin.rpc("publish_site", {
      p_page_id: o.pageId,
      p_owner_id: o.userId,
      p_home: publishDoc([LIVE] as Block[]) as never,
      p_sub_pages: [] as never,
      p_published_at: new Date().toISOString(),
    });
    expect(published.error).toBeNull();
    // The draft drops the live form, renames nothing live and adds a new one.
    const draft = await setPageDraft(admin, o.pageId, {
      version: 1,
      rev: 2,
      profile: { name: "Audience", bio: "", photo: null },
      theme: { ref: null, overrides: {} },
      blocks: [{ ...NEXT }],
    });
    expect(draft.error).toBeNull();
    const labels = await audience.loadFormLabels(admin, o.pageId);
    const { formLabelOf } = await import("@/lib/forms/export");
    expect(formLabelOf(labels, LIVE.id)).toBe("Live list · Home");
    expect(formLabelOf(labels, NEXT.id)).toBe("Next list · Home");
    expect(formLabelOf(labels, "formGoneLbl1")).toBe(contract.AUDIENCE_COPY.removedForm);
  });

  it("a published heading wins over a changed draft heading", async () => {
    const o = await owner("faud-lbl2");
    await admin.rpc("publish_site", {
      p_page_id: o.pageId,
      p_owner_id: o.userId,
      p_home: publishDoc([LIVE] as Block[]) as never,
      p_sub_pages: [] as never,
      p_published_at: new Date().toISOString(),
    });
    await setPageDraft(admin, o.pageId, {
      version: 1,
      rev: 2,
      profile: { name: "Audience", bio: "", photo: null },
      theme: { ref: null, overrides: {} },
      blocks: [{ ...LIVE, heading: "Renamed in the draft" }],
    });
    const labels = await audience.loadFormLabels(admin, o.pageId);
    expect(labels.get(LIVE.id)).toBe("Live list · Home");
  });

  it("?page= past the last page shows the last page; deleting the last row of page 2 shows page 1", async () => {
    const o = await owner("faud-page");
    await seedFormRows(o.pageId, contract.AUDIENCE_PAGE_SIZE + 1, {
      blockId: LIVE.id,
      stepSeconds: 1,
    });
    const two = await audience.loadAudienceWithClient(
      admin,
      { siteId: o.pageId, form: "all", page: 2 },
      usage,
    );
    expect(two).toMatchObject({ page: 2, pages: 2, total: 51 });
    expect(two.rows).toHaveLength(1);
    const far = await audience.loadAudienceWithClient(
      admin,
      { siteId: o.pageId, form: "all", page: 99 },
      usage,
    );
    expect(far).toMatchObject({ page: 2, pages: 2 });
    expect(far.rows).toHaveLength(1);

    await admin.from("form_submissions").delete().eq("id", two.rows[0]!.id);
    const after = await audience.loadAudienceWithClient(
      admin,
      { siteId: o.pageId, form: "all", page: 2 },
      usage,
    );
    expect(after).toMatchObject({ page: 1, pages: 1, total: 50 });
    expect(after.rows).toHaveLength(50);
    // A filter with nothing in it is page 1 of 1, empty.
    const none = await audience.loadAudienceWithClient(
      admin,
      { siteId: o.pageId, form: "formNoneLbl1", page: 3 },
      usage,
    );
    expect(none).toMatchObject({ page: 1, pages: 1, total: 0, rows: [] });
  }, 60_000);

  it("the export is newest first, by time then id, and at most the newest N (real loader, small N)", async () => {
    const o = await owner("faud-exp");
    await seedFormRows(o.pageId, 7, { blockId: LIVE.id, stepSeconds: 60, prefix: "exp" });
    const { rows } = await audience.loadAudienceExportWithClient(
      admin,
      { siteId: o.pageId, form: "all" },
      { maxRows: 5, pageRows: 2 },
    );
    expect(rows.map((row) => row.email)).toEqual([
      "exp7@example.test",
      "exp6@example.test",
      "exp5@example.test",
      "exp4@example.test",
      "exp3@example.test",
    ]);
    const times = rows.map((row) => Date.parse(row.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // All of them when N is larger, read a page at a time.
    const all = await audience.loadAudienceExportWithClient(
      admin,
      { siteId: o.pageId, form: LIVE.id },
      { maxRows: 50, pageRows: 3 },
    );
    expect(all.rows).toHaveLength(7);
    expect(all.rows[0]!.email).toBe("exp7@example.test");
  }, 60_000);
});

describe.skipIf(!run)(
  "forms attack pass finding 6: today's skipped owner emails (local Supabase)",
  () => {
    const owners: TestOwner[] = [];
    afterAll(async () => {
      await removeOwners(adminClient(), owners);
    });

    it("loadFormUsage reads the emails skipped today from form_usage", async () => {
      const admin = adminClient();
      const owner = await makeOwner(admin, "fskip");
      owners.push(owner);
      const { loadFormUsage } = await import("@/lib/forms/usage");
      expect((await loadFormUsage(owner.userId, "free", admin)).notifySkippedToday).toBe(0);
      for (let i = 0; i < 3; i++) {
        const { error } = await admin.rpc("record_form_notify_skipped", { p_owner: owner.userId });
        expect(error).toBeNull();
      }
      expect(await loadFormUsage(owner.userId, "free", admin)).toMatchObject({
        notifySkippedToday: 3,
        stored: 0,
        limit: 100,
      });
    }, 60_000);
  },
);
