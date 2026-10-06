/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDraft } from "@/lib/editor/load";
import { toPublishForm, type DraftDoc } from "@/lib/document";
import { PLAN_LIMITS } from "@/lib/limits";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminForTests, makeRuntime } from "./support/mcp-db";
import { richDraft } from "./support/mcp-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M10-24, M10-29 and M10-30 against the local database: list_pages, get_page, get_analytics and
 * get_domains read the caller's own data in a documented shape, never another account's, never the
 * published page as a draft, and never anything internal. Skipped when the stack is not up.
 */
const { run } = await stackIsUp();
const DAY_MS = 86_400_000;
const dayAt = (offset: number) => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
};

describe.skipIf(!run)("the read tools (local Supabase)", () => {
  let admin: SupabaseClient;
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  const owners: TestOwner[] = [];

  async function owner(
    label: string,
    draft?: (handle: string, id: string) => unknown,
    plan: "free" | "pro" | "studio" = "pro",
  ) {
    const made = draft
      ? await makeOwner(admin, label, (handle) => ({ __pending: handle }), plan)
      : await makeOwner(admin, label, undefined, plan);
    if (draft) {
      const { error } = await admin
        .from("pages")
        .update({ draft: draft(made.handle, made.userId) as never })
        .eq("id", made.pageId);
      if (error) throw new Error(error.message);
    }
    owners.push(made);
    return made;
  }
  async function extraPage(o: TestOwner, label: string, draft: unknown, published?: unknown) {
    const handle = `zq-${label}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await admin
      .from("pages")
      .insert({
        owner_id: o.userId,
        handle,
        draft: draft as never,
        ...(published
          ? { published: published as never, published_at: "2026-10-02T10:00:00Z" }
          : {}),
      })
      .select("id, handle")
      .single();
    if (error) throw new Error(error.message);
    return { pageId: data.id as string, handle: data.handle as string };
  }
  const who = (o: TestOwner) => ({ userId: o.userId });
  const everything = (value: unknown) => JSON.stringify(value);

  beforeAll(async () => {
    admin = adminForTests();
    rt = await makeRuntime(admin);
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  describe("list_pages", () => {
    it("lists the caller's pages oldest first with the plan, the status of each and nothing of anyone else", async () => {
      const a = await owner("lp-a", (h, id) => ({ ...richDraft(h, id), rev: 1 }), "pro");
      // 1) never published (a.pageId). 2) published and unchanged. 3) published, then edited.
      const unchanged = {
        ...richDraft("x", a.userId),
        rev: 2,
        banner: undefined,
        redirect: undefined,
      };
      const second = await extraPage(
        a,
        "lp-a2",
        unchanged,
        toPublishForm(unchanged as DraftDoc, null),
      );
      const edited = {
        ...richDraft("y", a.userId),
        rev: 2,
        banner: undefined,
        redirect: undefined,
      };
      const third = await extraPage(
        a,
        "lp-a3",
        { ...edited, profile: { ...edited.profile, name: "Edited after publishing" } },
        toPublishForm(edited as DraftDoc, null),
      );
      await admin.from("domains").insert({
        page_id: a.pageId,
        hostname: `links-${a.handle}.example.test`,
        status: "verified",
        verified_at: new Date().toISOString(),
      });

      const b = await owner("lp-b", (h, id) => richDraft(h, id), "studio");
      await extraPage(b, "lp-b2", richDraft("b2", b.userId));
      await admin.from("domains").insert({
        page_id: b.pageId,
        hostname: `other-${b.handle}.example.test`,
        status: "verified",
        verified_at: new Date().toISOString(),
      });

      const out = await rt.call("list_pages", {}, who(a));
      expect(out.isError).toBe(false);
      const { account, pages } = out.json!;
      expect(account).toEqual({
        plan: "pro",
        pagesUsed: 3,
        pagesAllowed: PLAN_LIMITS.pro.pages,
        pagesPerSiteAllowed: PLAN_LIMITS.pro.pagesPerSite,
      });
      expect(pages.map((page: { id: string }) => page.id)).toEqual([
        a.pageId,
        second.pageId,
        third.pageId,
      ]);
      expect(pages.map((page: { publishStatus: string }) => page.publishStatus)).toEqual([
        "not-published",
        "published",
        "unpublished-changes",
      ]);
      expect(pages[0]).toMatchObject({
        id: a.pageId,
        handle: a.handle,
        address: `${a.handle}.hydlnk.com`,
        url: `http://${a.handle}.localhost:3000`,
        publishedAt: null,
        customDomains: [{ hostname: `links-${a.handle}.example.test`, status: "verified" }],
      });
      expect(pages[1].publishedAt).toBeTruthy();
      expect(Object.keys(pages[0]).sort()).toEqual([
        "address",
        "customDomains",
        "handle",
        "id",
        "name",
        "pageCount",
        "pages",
        "publishStatus",
        "publishedAt",
        "updatedAt",
        "url",
      ]);
      expect(out.text).toMatch(/^You have 3 pages: /);
      // Nothing of the other account, and nothing internal.
      expect(everything(out.raw)).not.toContain(b.handle);
      expect(everything(out.raw)).not.toContain(b.userId);
      expect(everything(out.raw)).not.toMatch(/owner_id|stripe|sb_|hl_at_|hl_rt_|hl_ac_/);
      expect(everything(out.raw)).not.toContain(a.userId);
    });

    it("says so in one sentence for a single page, in the form 'You have 1 page: x.hydlnk.com (published).'", async () => {
      const a = await owner("lp-one", (h, id) => {
        const draft = { ...richDraft(h, id), banner: undefined, redirect: undefined };
        return draft;
      });
      await admin
        .from("pages")
        .update({
          published: toPublishForm(richDraft(a.handle, a.userId) as DraftDoc, null) as never,
          published_at: "2026-10-02T10:00:00Z",
        })
        .eq("id", a.pageId);
      const out = await rt.call("list_pages", {}, who(a));
      expect(out.text).toMatch(
        /^You have 1 page: [a-z0-9-]+\.hydlnk\.com \((published|unpublished changes)\)\.$/,
      );
    });

    it("two users calling at once each get only their own pages (50 rounds in parallel)", async () => {
      const a = await owner("lp-par-a");
      const b = await owner("lp-par-b");
      for (let round = 0; round < 50; round++) {
        const [ra, rb] = await Promise.all([
          rt.call("list_pages", {}, who(a)),
          rt.call("list_pages", {}, who(b)),
        ]);
        expect(ra.json!.pages.map((page: { id: string }) => page.id)).toEqual([a.pageId]);
        expect(rb.json!.pages.map((page: { id: string }) => page.id)).toEqual([b.pageId]);
      }
    });
  });

  describe("get_page", () => {
    it("reads the DRAFT: a string only in the draft is there, a string only in the published page is not", async () => {
      const a = await owner("gp-draft", (h, id) => {
        const draft = richDraft(h, id) as DraftDoc;
        return { ...draft, profile: { ...draft.profile, bio: "DRAFT-ONLY-7f3a" } };
      });
      const publishedDraft = richDraft(a.handle, a.userId) as DraftDoc;
      const published = toPublishForm(
        { ...publishedDraft, profile: { ...publishedDraft.profile, bio: "PUBLISHED-ONLY-91c2" } },
        null,
      );
      await admin
        .from("pages")
        .update({ published: published as never, published_at: "2026-10-02T10:00:00Z" })
        .eq("id", a.pageId);
      const out = await rt.call("get_page", { pageId: a.pageId }, who(a));
      const text = everything(out.raw);
      expect(text).toContain("DRAFT-ONLY-7f3a");
      expect(text).not.toContain("PUBLISHED-ONLY-91c2");
      expect(out.json!.page).toMatchObject({
        id: a.pageId,
        handle: a.handle,
        publishStatus: "unpublished-changes",
        hasUnpublishedChanges: true,
        rev: 3,
      });
    });

    it("has the documented shape, hides locks, mark details and analytics ids, and shows images by file name only", async () => {
      const a = await owner("gp-shape", (h, id) => {
        const draft = richDraft(h, id) as any;
        draft.blocks[0].lock = { kind: "code", salt: "S".repeat(22), hash: "H".repeat(43) };
        return draft;
      });
      const out = await rt.call("get_page", { pageId: a.pageId }, who(a));
      const view = out.json!;
      expect(Object.keys(view).sort()).toEqual([
        "alsoSetInTheApp",
        "blocks",
        "limits",
        "page",
        "profile",
        "publishIssues",
        "theme",
      ]);
      expect(view.profile).toEqual({
        name: "Mara Okafor",
        bio: "Ceramics and slow mornings.",
        photo: { imageId: "photo0000001.webp", width: 600, height: 600 },
        photoShape: "square",
        photoSize: "large",
        photoBorder: "thin",
        showPhoto: true,
        showName: true,
        showBio: false,
      });
      expect(view.theme).toMatchObject({
        kind: "none",
        id: null,
        overrides: { accent: "#112233", radius: 6 },
      });
      expect(Object.keys(view.theme.resolved).sort()).toEqual([
        "accent",
        "bg",
        "buttonStyle",
        "fontBody",
        "fontHeading",
        "radius",
        "text",
      ]);
      expect(view.theme.resolved.accent).toBe("#112233");
      expect(view.limits).toEqual({ blocks: { used: 6, max: 50 } });
      expect(view.alsoSetInTheApp).toEqual(["banner", "share card", "UTM tags", "redirect mode"]);
      const [link, text, card, social, faq, map] = view.blocks;
      expect(link).toMatchObject({
        id: "link-id-001",
        type: "link",
        visible: true,
        label: "Shop",
        featured: "bold",
        lock: { locked: true, kind: "code" },
      });
      expect(everything(view)).not.toMatch(/HHHHH|SSSSS/);
      expect(text.formatting).toMatch(/^1 link, bold and alignment\./);
      expect(text.formatting).toContain("Tools can’t edit formatting");
      expect(everything(text)).not.toContain("mark-id-001");
      expect(card.image).toEqual({ imageId: "glaze000001.webp", width: 800, height: 400 });
      expect(social.icons).toEqual([
        { id: "icon-id-0001", platform: "github", url: "https://github.com/mara" },
        { id: "icon-id-0002", platform: "email", address: "mara@example.com" },
      ]);
      expect(faq).toMatchObject({
        visible: false,
        items: [{ id: "faq-item-001", question: "Do you ship?", answer: "Yes, worldwide." }],
      });
      expect(map).toEqual({
        id: "map-id-00001",
        type: "map",
        visible: true,
        name: "Studio",
        address: "1 Kiln Lane",
      });
      // No user id, email, storage path, Stripe value or internal column anywhere.
      const all = everything(out.raw);
      expect(all).not.toContain(a.userId);
      expect(all).not.toContain(a.email);
      expect(all).not.toMatch(
        /owner_id|stripe|sb_|hl_at_|hl_rt_|hl_ac_|page-media|\.webp".*path|"path"/,
      );
      expect(all).not.toContain(`${a.userId}/`);
    });

    it("its profile, blocks and visibility equal what the editor's loader gives for the page", async () => {
      const a = await owner("gp-loader", (h, id) => richDraft(h, id));
      const raw = (await admin.from("pages").select("draft").eq("id", a.pageId).single()).data!
        .draft;
      const loaded = loadDraft(raw, a.handle).draft;
      const out = await rt.call("get_page", { pageId: a.pageId }, who(a));
      expect(out.json!.blocks.map((block: any) => [block.id, block.type, block.visible])).toEqual(
        loaded.blocks.map((block) => [block.id, block.type, block.visible !== false]),
      );
      expect(out.json!.profile.name).toBe(loaded.profile.name);
      expect(out.json!.profile.bio).toBe(loaded.profile.bio);
      expect(out.json!.theme.overrides).toEqual(loaded.theme.overrides);
    });

    it("lists what Publish would refuse in Publish's own words, and one block by blockId", async () => {
      const a = await owner("gp-issues", (h, id) => {
        const draft = richDraft(h, id) as any;
        draft.blocks[0].label = "";
        return draft;
      });
      const out = await rt.call("get_page", { pageId: a.pageId }, who(a));
      expect(out.json!.publishIssues).toContainEqual({
        blockId: "link-id-001",
        field: "label",
        message: "Add a link label.",
      });
      const one = await rt.call("get_page", { pageId: a.pageId, blockId: "map-id-00001" }, who(a));
      expect(Object.keys(one.json!)).toEqual(["page", "block"]);
      expect(one.json!.block).toMatchObject({ id: "map-id-00001", name: "Studio" });
      const missing = await rt.call("get_page", { pageId: a.pageId, blockId: "nope" }, who(a));
      expect(missing.error).toMatchObject({
        code: "block_not_found",
        message: "No block with that id on this page. Call get_page.",
      });
    });

    it("a block id of another page is block_not_found, and a page with several pages needs a pageId", async () => {
      const a = await owner("gp-multi", (h, id) => richDraft(h, id));
      await extraPage(a, "gp-multi2", { ...richDraft("m2", a.userId), blocks: [] });
      const none = await rt.call("get_page", {}, who(a));
      expect(none.error).toMatchObject({
        code: "invalid_input",
        message: "pageId is required. You have 2 pages: call list_pages.",
      });
      const second = (
        await admin.from("pages").select("id").eq("owner_id", a.userId).neq("id", a.pageId).single()
      ).data!.id;
      const other = await rt.call("get_page", { pageId: second, blockId: "map-id-00001" }, who(a));
      expect(other.error!.code).toBe("block_not_found");
      const single = await owner("gp-single", (h, id) => richDraft(h, id));
      expect((await rt.call("get_page", {}, who(single))).isError).toBe(false);
    });

    it("only reads: no update or insert but the activity row", async () => {
      const a = await owner("gp-readonly", (h, id) => richDraft(h, id));
      const before = (await admin.from("pages").select("*").eq("id", a.pageId).single()).data;
      await rt.call("get_page", { pageId: a.pageId }, who(a));
      await rt.call("list_pages", {}, who(a));
      expect((await admin.from("pages").select("*").eq("id", a.pageId).single()).data).toEqual(
        before,
      );
    });
  });

  describe("get_analytics", () => {
    it("a page that has recorded nothing is recorded: false, never the sample set", async () => {
      const a = await owner("an-empty", (h, id) => richDraft(h, id), "pro");
      const out = await rt.call("get_analytics", { pageId: a.pageId }, who(a));
      expect(out.json).toMatchObject({
        recorded: false,
        kpis: null,
        topLinks: [],
        breakdowns: null,
        published: false,
      });
      expect(out.text).toBe(
        "Your page isn’t published yet. No views or clicks have been recorded.",
      );
      await admin
        .from("pages")
        .update({ published: { version: 1 } as never, published_at: new Date().toISOString() })
        .eq("id", a.pageId);
      const live = await rt.call("get_analytics", { pageId: a.pageId }, who(a));
      expect(live.text).toBe(
        "No views or clicks have been recorded yet. Publish the page and share it to start counting.",
      );
    });

    it("Free keeps 30 days: 90d and 1y are plan_required, 7d and 30d work, and Pro gets all four", async () => {
      const free = await owner("an-free", (h, id) => richDraft(h, id), "free");
      for (const range of ["90d", "1y"]) {
        const out = await rt.call("get_analytics", { pageId: free.pageId, range }, who(free));
        expect(out.error).toMatchObject({
          code: "plan_required",
          message: "Free keeps 30 days of numbers. Pro and Studio show up to a year.",
        });
      }
      for (const range of ["7d", "30d", undefined])
        expect(
          (
            await rt.call(
              "get_analytics",
              { pageId: free.pageId, ...(range ? { range } : {}) },
              who(free),
            )
          ).isError,
        ).toBe(false);
      const pro = await owner("an-pro", (h, id) => richDraft(h, id), "pro");
      for (const range of ["7d", "30d", "90d", "1y"])
        expect(
          (await rt.call("get_analytics", { pageId: pro.pageId, range }, who(pro))).isError,
        ).toBe(false);
      expect(
        (await rt.call("get_analytics", { pageId: pro.pageId, range: "2y" }, who(pro))).error!.code,
      ).toBe("invalid_input");
    });

    it("gives the screen's own numbers, with breakdowns on Pro and none on Free, and never another page's", async () => {
      const seed = async (o: TestOwner) => {
        const published = {
          version: 1,
          blocks: [
            { id: "link-id-001", type: "link", label: "Shop", url: "https://example.com/shop" },
          ],
        };
        await admin
          .from("pages")
          .update({ published: published as never, published_at: new Date().toISOString() })
          .eq("id", o.pageId);
        const event = (ts: string, type: "view" | "click", visitor: string, over: object = {}) => ({
          page_id: o.pageId,
          ts,
          type,
          block_id: type === "click" ? "link-id-001" : "",
          visitor_hash: visitor,
          referrer: "instagram.com",
          device: "mobile",
          country: "US",
          ...over,
        });
        const past = dayAt(-2);
        await admin
          .from("events")
          .insert([
            event(`${past}T10:00:00Z`, "view", "a"),
            event(`${past}T10:05:00Z`, "view", "b"),
            event(`${past}T10:06:00Z`, "click", "a"),
          ]);
        await admin.rpc("rollup_daily_stats", { p_day: past });
        await admin
          .from("events")
          .insert([
            event(new Date().toISOString(), "view", "c"),
            event(new Date().toISOString(), "click", "c"),
          ]);
      };
      const pro = await owner("an-numbers", (h, id) => richDraft(h, id), "pro");
      await seed(pro);
      const other = await owner("an-other", (h, id) => richDraft(h, id), "pro");
      await seed(other);
      await admin.from("events").insert(
        Array.from({ length: 5 }, (_, n) => ({
          page_id: other.pageId,
          ts: new Date().toISOString(),
          type: "view",
          block_id: "",
          visitor_hash: `z${n}`,
          referrer: "leak.example",
          device: "desktop",
          country: "FR",
        })),
      );

      const { loadStatsResponse } = await import("@/lib/analytics/dashboard/load");
      const screen = await loadStatsResponse({
        ownerId: pro.userId,
        pageId: pro.pageId,
        range: 30,
      });
      if (!screen.ok) throw new Error("expected stats");
      const out = await rt.call("get_analytics", { pageId: pro.pageId, range: "30d" }, who(pro));
      expect(out.json!.kpis).toEqual({
        views: screen.data.kpis.views,
        clicks: screen.data.kpis.clicks,
        ctr: screen.data.kpis.ctr,
        uniques: screen.data.kpis.uniques,
      });
      expect(out.json!.kpis).toMatchObject({ views: 3, clicks: 2 });
      expect(out.json!.topLinks).toEqual(
        screen.data.links.map((link) => ({
          label: link.label,
          clicks: link.clicks,
          ctr: link.ctr,
        })),
      );
      expect(out.json!.window).toMatchObject({
        days: 30,
        start: screen.data.window.start,
        end: screen.data.window.end,
      });
      expect(out.json!.breakdowns.referrers[0]).toMatchObject({ label: "instagram.com" });
      expect(Object.keys(out.json!.breakdowns).sort()).toEqual([
        "countries",
        "devices",
        "referrers",
      ]);
      expect(out.text).toBe("Your page had 3 views and 2 clicks in the last 30 days.");
      expect(everything(out.raw)).not.toMatch(/leak\.example|"views":8/);
      // A Free owner of the same data gets the numbers and a note instead of the breakdowns.
      await admin.from("accounts").update({ plan: "free" }).eq("id", pro.userId);
      const free = await rt.call("get_analytics", { pageId: pro.pageId }, who(pro));
      expect(free.json).toMatchObject({
        breakdowns: null,
        note: "Referrers, devices and countries are on Pro and Studio.",
        recorded: true,
      });
      expect(free.json!.kpis.views).toBe(3);
    });

    it("another account's page is not_found", async () => {
      const a = await owner("an-own-a");
      const b = await owner("an-own-b");
      expect((await rt.call("get_analytics", { pageId: b.pageId }, who(a))).error!.code).toBe(
        "not_found",
      );
    });
  });

  describe("get_domains", () => {
    it("Free has none and is told so; Pro lists its own verified domain and never another account's", async () => {
      const free = await owner("dm-free", undefined, "free");
      const none = await rt.call("get_domains", {}, who(free));
      expect(none.json).toEqual({ domains: [], limits: { customDomains: { used: 0, max: 0 } } });
      expect(none.text).toBe("Custom domains are on Pro and Studio.");

      const pro = await owner("dm-pro", undefined, "pro");
      const stranger = await owner("dm-other", undefined, "studio");
      const mine = `mine-${pro.handle}.example.test`;
      await admin.from("domains").insert({
        page_id: pro.pageId,
        hostname: mine,
        status: "verified",
        verified_at: "2026-10-02T10:00:00Z",
      });
      await admin.from("domains").insert({
        page_id: stranger.pageId,
        hostname: `theirs-${stranger.handle}.example.test`,
        status: "verified",
        verified_at: "2026-10-02T10:00:00Z",
      });
      const out = await rt.call("get_domains", {}, who(pro));
      expect(out.json!.domains).toEqual([
        {
          hostname: mine,
          pageId: pro.pageId,
          status: "verified",
          verifiedAt: "2026-10-02T10:00:00+00:00",
          misconfigured: false,
          recordsUnavailable: false,
          note: null,
        },
      ]);
      expect(out.json!.limits).toEqual({
        customDomains: { used: 1, max: PLAN_LIMITS.pro.customDomains },
      });
      expect(everything(out.raw)).not.toContain("theirs-");
      expect(everything(out.raw)).not.toMatch(/lastCheckedAt|last_checked|createdAt|"id"/);
      expect(out.json!.domains[0]).not.toHaveProperty("dnsRecords");
    });
  });
});
