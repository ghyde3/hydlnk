/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPreviewToken } from "@/lib/previews/token";
import {
  makeOwner,
  removeOwners,
  draftOf as publishableDraft,
  stackIsUp,
  type TestOwner,
} from "./publish-support";
import { adminForTests, makeRuntime } from "./support/mcp-db";
import { richDraft } from "./support/mcp-fixtures";

const revalidated: Array<[string, unknown]> = [];
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, options: unknown) => {
    revalidated.push([tag, options]);
  },
  updateTag: () => {
    throw new Error("updateTag works in Server Actions only");
  },
}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M10-30 (create_preview_link), M10-31 (publish_page) and M10-32 (the activity log) against the local
 * database. publish_page is the Publish button's gate and nothing else, with the cache expired the
 * way a route handler may (`revalidateTag(tag, { expire: 0 })`, never `updateTag`); a refusal changes
 * nothing; the preview link's token is returned once and never written anywhere. Skipped when the
 * stack is not up.
 */
const { run } = await stackIsUp();

/** A limiter that counts like the real one: at most `limit` hits per key. */
function countingLimiter() {
  const hits = new Map<string, number>();
  const keys: Array<[string, number, number]> = [];
  return {
    keys,
    limit: async (key: string, limit: number, window: number) => {
      keys.push([key, limit, window]);
      const next = (hits.get(key) ?? 0) + 1;
      hits.set(key, next);
      return next > limit ? { allowed: false, retryAfter: 123 } : { allowed: true, retryAfter: 0 };
    },
  };
}

describe.skipIf(!run)(
  "publish_page, create_preview_link and the activity log (local Supabase)",
  () => {
    let admin: SupabaseClient;
    let rt: Awaited<ReturnType<typeof makeRuntime>>;
    const owners: TestOwner[] = [];
    const blocked: string[] = [];

    async function owner(
      label: string,
      plan: "free" | "pro" | "studio" = "pro",
      draft?: (handle: string, id: string) => unknown,
    ) {
      const made = await makeOwner(
        admin,
        label,
        (handle) => (draft ? { __pending: handle } : publishableDraft(handle)),
        plan,
      );
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
    const who = (o: TestOwner) => ({ userId: o.userId });
    const row = async (o: TestOwner) =>
      (
        await admin
          .from("pages")
          .select("published, published_at, draft")
          .eq("id", o.pageId)
          .single()
      ).data!;
    const versions = async (o: TestOwner) =>
      (
        await admin
          .from("page_versions")
          .select("id", { count: "exact", head: true })
          .eq("page_id", o.pageId)
      ).count ?? 0;

    beforeAll(async () => {
      admin = adminForTests();
      rt = await makeRuntime(admin);
    });
    afterAll(async () => {
      if (blocked.length > 0) await admin.from("blocked_domains").delete().in("domain", blocked);
      await removeOwners(admin, owners);
    });

    describe("publish_page", () => {
      it("runs the real gate: the saved draft becomes the live page, the cache is expired at once, and the result says where it is", async () => {
        const o = await owner("pp-ok");
        revalidated.length = 0;
        const out = await rt.call("publish_page", { pageId: o.pageId }, who(o));
        expect(out.isError, JSON.stringify(out.error)).toBe(false);
        expect(out.text).toBe(`Published. Your page is live at http://${o.handle}.localhost:3000.`);
        expect(out.json).toMatchObject({
          published: true,
          url: `http://${o.handle}.localhost:3000`,
        });
        expect(Date.parse(out.json!.publishedAt)).toBeGreaterThan(Date.now() - 60_000);
        const stored = await row(o);
        expect(stored.published).toMatchObject({ version: 1, profile: { name: o.handle } });
        expect(stored.published_at).toBeTruthy();
        // `revalidateTag(tag, { expire: 0 })`: nothing stale is served. updateTag would have thrown.
        expect(revalidated).toEqual([[`page:${o.pageId}`, { expire: 0 }]]);
      });

      it("a Pro page gets a version row like the button gives; a Free page does not", async () => {
        const pro = await owner("pp-pro", "pro");
        const free = await owner("pp-free", "free");
        await rt.call("publish_page", { pageId: pro.pageId }, who(pro));
        await rt.call("publish_page", { pageId: free.pageId }, who(free));
        expect(await versions(pro)).toBe(1);
        expect(await versions(free)).toBe(0);
      });

      it("publishing twice with no change succeeds twice with the same content, and published_at moves", async () => {
        const o = await owner("pp-twice");
        const first = await rt.call("publish_page", { pageId: o.pageId }, who(o));
        const one = await row(o);
        await new Promise((resolve) => setTimeout(resolve, 15));
        const second = await rt.call("publish_page", { pageId: o.pageId }, who(o));
        const two = await row(o);
        expect(first.isError || second.isError).toBe(false);
        expect(two.published).toEqual(one.published);
        expect(Date.parse(two.published_at)).toBeGreaterThan(Date.parse(one.published_at));
      });

      it("names the page's verified custom domain too", async () => {
        const o = await owner("pp-domain");
        await admin.from("domains").insert({
          page_id: o.pageId,
          hostname: `links-${o.handle}.example.test`,
          status: "verified",
          verified_at: new Date().toISOString(),
        });
        const out = await rt.call("publish_page", { pageId: o.pageId }, who(o));
        expect(out.text).toContain(`It is also at http://links-${o.handle}.example.test:3000.`);
        expect(out.json!.customDomainUrls).toEqual([`http://links-${o.handle}.example.test:3000`]);
      });

      it("a refusal is plain, lists what to fix, and changes nothing: the live page, the versions and the cache stay", async () => {
        const o = await owner("pp-refuse", "pro", (h, id) => ({
          ...richDraft(h, id),
          redirect: undefined,
          banner: undefined,
          blocks: [
            { id: "bad-link-0001", type: "link", visible: true, label: "", url: "" },
            { id: "bad-link-0002", type: "link", visible: true, label: "", url: "not a url" },
          ],
        }));
        await admin
          .from("pages")
          .update({
            published: { version: 1, kept: "LIVE-BEFORE" } as never,
            published_at: "2026-10-01T10:00:00Z",
          })
          .eq("id", o.pageId);
        const baseline = await versions(o);
        revalidated.length = 0;
        const out = await rt.call("publish_page", { pageId: o.pageId }, who(o));
        expect(out.error!.code).toBe("publish_refused");
        expect(out.error!.message).toMatch(/^Publishing stopped\. Add a link label\. \(2 places\)/);
        expect(out.error!.issues).toContainEqual({
          path: "bad-link-0001:label",
          message: "Add a link label.",
        });
        expect(out.error!.issues!.length).toBeLessThanOrEqual(20);
        const stored = await row(o);
        expect(stored.published).toEqual({ version: 1, kept: "LIVE-BEFORE" });
        expect(stored.published_at).toBe("2026-10-01T10:00:00+00:00");
        expect(await versions(o)).toBe(baseline);
        expect(revalidated).toEqual([]);
      });

      it("an image that is not in storage stops the publish with the gate's own words", async () => {
        const o = await owner("pp-image", "pro", (h, id) => ({
          ...richDraft(h, id),
          redirect: undefined,
          banner: undefined,
          blocks: [],
        }));
        const out = await rt.call("publish_page", { pageId: o.pageId }, who(o));
        expect(out.error!.code).toBe("publish_refused");
        expect(out.error!.message).toContain("That image is no longer available. Upload it again.");
      });

      it("a link whose site was blocked after the draft was saved is blocked_link, with the editor's sentence", async () => {
        const o = await owner("pp-blocked");
        const domain = `late-${Math.random().toString(36).slice(2, 8)}.example`;
        const draft = (await row(o)).draft as any;
        draft.blocks = [
          {
            id: "late-link-0001",
            type: "link",
            visible: true,
            label: "Late",
            url: `https://${domain}/x`,
          },
        ];
        await admin.from("pages").update({ draft }).eq("id", o.pageId);
        await admin.from("blocked_domains").insert({ domain, reason: "test" });
        blocked.push(domain);
        const out = await rt.call("publish_page", { pageId: o.pageId }, who(o));
        expect(out.error).toMatchObject({
          code: "blocked_link",
          message: `Can’t publish. 1 link points to a blocked site: ${domain}. Remove or change it.`,
        });
        expect((await row(o)).published).toBeNull();
      });

      it("redirect mode on a Free account is refused by the gate's own words, not the tool's", async () => {
        const free = await owner("pp-redirect", "free", (h) => ({
          ...publishableDraft(h),
          redirect: { linkId: "lnk-aaaaaaaa" },
          rev: 1,
        }));
        const out = await rt.call("publish_page", { pageId: free.pageId }, who(free));
        expect(out.error!.code).toBe("publish_refused");
        expect((await row(free)).published).toBeNull();
      });

      it("needs the publish scope, another account's page is not_found, and a suspended owner is account_suspended", async () => {
        const o = await owner("pp-guards");
        const stranger = await owner("pp-guards-b");
        const scoped = await rt.call(
          "publish_page",
          { pageId: o.pageId },
          { ...who(o), scopes: ["hydlnk.read", "hydlnk.write"] },
        );
        expect(scoped.error).toMatchObject({
          code: "insufficient_scope",
          requiredScope: "hydlnk.publish",
        });
        expect(scoped.meta!["mcp/www_authenticate"][0]).toContain('scope="hydlnk.publish"');
        expect(
          (await rt.call("publish_page", { pageId: stranger.pageId }, who(o))).error!.code,
        ).toBe("not_found");
        await admin
          .from("accounts")
          .update({ suspended_at: new Date().toISOString() })
          .eq("id", o.userId);
        expect((await rt.call("publish_page", { pageId: o.pageId }, who(o))).error!.code).toBe(
          "account_suspended",
        );
        expect((await row(o)).published).toBeNull();
        expect((await row(stranger)).published).toBeNull();
      });

      it("is limited to 10 an hour per person across all tokens, on top of the general limits", async () => {
        const o = await owner("pp-limit");
        const counted = countingLimiter();
        const limited = await makeRuntime(admin, { limit: counted.limit });
        for (let n = 1; n <= 10; n++) {
          const out = await limited.call(
            "publish_page",
            { pageId: o.pageId },
            { ...who(o), tokenId: `00000000-0000-4000-8000-${String(n % 2).padStart(12, "0")}` },
          );
          expect(out.isError, `publish ${n}`).toBe(false);
        }
        const eleventh = await limited.call("publish_page", { pageId: o.pageId }, who(o));
        expect(eleventh.error).toMatchObject({
          code: "rate_limited",
          retryAfterSeconds: 123,
          message: "You’re going too fast. Try again in 123 seconds.",
        });
        expect(
          counted.keys.some(
            ([key, limit, window]) =>
              key === `mcp-publish:${o.userId}` && limit === 10 && window === 3600,
          ),
        ).toBe(true);
      });

      it("publishes the SAVED draft: what is in the database now, not what an editor has typed and not yet saved", async () => {
        const o = await owner("pp-saved");
        const saved = (await row(o)).draft as any;
        const first = await rt.call(
          "update_profile",
          { pageId: o.pageId, bio: "Saved bio" },
          who(o),
        );
        expect(first.isError).toBe(false);
        await rt.call("publish_page", { pageId: o.pageId }, who(o));
        expect(((await row(o)).published as any).profile.bio).toBe("Saved bio");
        void saved;
      });
    });

    describe("create_preview_link", () => {
      it("returns the link once, stores only its hash, and the link opens the saved draft route on the app host", async () => {
        const o = await owner("pl-ok");
        const out = await rt.call("create_preview_link", { pageId: o.pageId }, who(o));
        expect(out.isError, JSON.stringify(out.error)).toBe(false);
        expect(out.text).toBe("Preview link created. It shows your saved draft for 7 days.");
        const url = out.json!.url as string;
        expect(url).toMatch(/^http:\/\/app\.localhost:3000\/share\/[A-Za-z0-9_-]{43}$/);
        expect(Date.parse(out.json!.expiresAt)).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
        expect(Date.parse(out.json!.expiresAt)).toBeLessThan(Date.now() + 7.1 * 86_400_000);
        const token = url.split("/share/")[1]!;
        const links = await admin.from("preview_links").select("*").eq("page_id", o.pageId);
        expect(links.data).toHaveLength(1);
        expect(links.data![0].token_hash).toBe(hashPreviewToken(token));
        expect(JSON.stringify(links.data)).not.toContain(token);
        // The token is in the result and nowhere else: not in the activity row, not in a log line.
        await rt.flush();
        const activity = await admin.from("mcp_activity").select("*").eq("user_id", o.userId);
        expect(JSON.stringify(activity.data)).not.toContain(token);
        expect(JSON.stringify(rt.activity)).not.toContain(token);
        expect(rt.logs.join("\n")).not.toContain(token);
        expect(out.structured.url).toBe(url);
      });

      it("Free, Pro and Studio can make links, a second link works too, and a page with 5 active links is preview_link_limit", async () => {
        for (const plan of ["free", "studio"] as const) {
          const o = await owner(`pl-${plan}`, plan);
          expect(
            (await rt.call("create_preview_link", { pageId: o.pageId }, who(o))).isError,
            plan,
          ).toBe(false);
        }
        const o = await owner("pl-five");
        for (let n = 0; n < 5; n++)
          expect((await rt.call("create_preview_link", { pageId: o.pageId }, who(o))).isError).toBe(
            false,
          );
        const sixth = await rt.call("create_preview_link", { pageId: o.pageId }, who(o));
        expect(sixth.error).toMatchObject({
          code: "preview_link_limit",
          message: "You have 5 active preview links. Turn one off to make another.",
        });
      });

      it("another account's page creates nothing, and a deleted page, a read-only token and a suspended owner are refused", async () => {
        const a = await owner("pl-a");
        const b = await owner("pl-b");
        const gone = await owner("pl-gone");
        await admin.from("pages").delete().eq("id", gone.pageId);
        expect(
          (await rt.call("create_preview_link", { pageId: b.pageId }, who(a))).error!.code,
        ).toBe("not_found");
        expect(
          (await rt.call("create_preview_link", { pageId: gone.pageId }, who(gone))).error!.code,
        ).toBe("not_found");
        expect(
          (
            await rt.call(
              "create_preview_link",
              { pageId: a.pageId },
              { ...who(a), scopes: ["hydlnk.read"] },
            )
          ).error!.code,
        ).toBe("insufficient_scope");
        expect(
          (
            await admin
              .from("preview_links")
              .select("id", { count: "exact", head: true })
              .eq("page_id", b.pageId)
          ).count,
        ).toBe(0);
        await admin
          .from("accounts")
          .update({ suspended_at: new Date().toISOString() })
          .eq("id", a.userId);
        expect(
          (await rt.call("create_preview_link", { pageId: a.pageId }, who(a))).error!.code,
        ).toBe("account_suspended");
      });

      it("shares the app's own limit, preview-link:{userId} at 20 an hour, so links made in the editor count together", async () => {
        const o = await owner("pl-shared");
        const counted = countingLimiter();
        const limited = await makeRuntime(admin, { limit: counted.limit });
        const out = await limited.call("create_preview_link", { pageId: o.pageId }, who(o));
        expect(out.isError).toBe(false);
        expect(counted.keys).toContainEqual([`preview-link:${o.userId}`, 20, 3600]);
        // At the limit the tool says so in the app's own words.
        const stingy = await makeRuntime(admin, {
          limit: async (key) =>
            key.startsWith("preview-link:")
              ? { allowed: false, retryAfter: 9 }
              : { allowed: true, retryAfter: 0 },
        });
        const refused = await stingy.call("create_preview_link", { pageId: o.pageId }, who(o));
        expect(refused.error).toMatchObject({ code: "rate_limited" });
      });
    });

    describe("the activity log", () => {
      it("holds exactly one row per tool call, in order, with the tool, the page and the outcome, and never any content", async () => {
        const o = await owner("al-rows", "pro", (h, id) => ({
          ...richDraft(h, id),
          redirect: undefined,
          banner: undefined,
        }));
        const stranger = await owner("al-other");
        const mine = await makeRuntime(admin);
        const CANARY = "CANARY-9c1e7f-secret-text";
        const calls: Array<[string, Record<string, unknown>]> = [
          ["list_pages", {}],
          ["get_page", { pageId: o.pageId }],
          ["update_profile", { pageId: o.pageId, bio: CANARY }],
          [
            "add_block",
            {
              pageId: o.pageId,
              type: "link",
              fields: { label: CANARY, url: `https://example.com/${CANARY}` },
            },
          ],
          ["add_block", { pageId: o.pageId, type: "text", fields: { text: "x".repeat(700) } }],
          ["get_page", { pageId: stranger.pageId }],
          ["set_theme", { pageId: o.pageId, theme: "Noir" }],
          ["get_analytics", { pageId: o.pageId }],
          ["get_domains", {}],
          ["create_preview_link", { pageId: o.pageId }],
          ["remove_block", { pageId: o.pageId, blockId: "nope" }],
        ];
        for (const [tool, input] of calls) await mine.call(tool, input, who(o));
        await mine.flush();
        const rows = (
          await admin
            .from("mcp_activity")
            .select("*")
            .eq("user_id", o.userId)
            .order("id", { ascending: true })
        ).data!;
        expect(rows.map((item) => item.tool)).toEqual(calls.map(([tool]) => tool));
        expect(rows.map((item) => item.ok)).toEqual([
          true,
          true,
          true,
          true,
          false,
          false,
          true,
          true,
          true,
          true,
          false,
        ]);
        expect(rows.map((item) => item.error_code)).toEqual([
          null,
          null,
          null,
          null,
          "invalid_input",
          "not_found",
          null,
          null,
          null,
          null,
          "block_not_found",
        ]);
        // The page is stored when the caller owned it, and never when the call was refused as not_found.
        expect(rows[1]!.page_id).toBe(o.pageId);
        expect(rows[5]!.page_id).toBeNull();
        expect(rows[0]!.page_id).toBeNull();
        expect(Object.keys(rows[0]!).sort()).toEqual([
          "at",
          "client_id",
          "error_code",
          "grant_id",
          "id",
          "ok",
          "page_id",
          "tool",
          "user_id",
        ]);
        // No canary text and no token anywhere in what was stored, logged or sent to the insert.
        const everything = JSON.stringify([rows, mine.activity, mine.logs]);
        expect(everything).not.toContain(CANARY);
        expect(everything).not.toMatch(/\/share\/[A-Za-z0-9_-]{43}/);
        // Another person's rows are not mixed in.
        expect(
          (await admin.from("mcp_activity").select("id").eq("user_id", stranger.userId)).data,
        ).toEqual([]);
      });

      it("refusals count: scope, rate limit, suspension, input and not_found each leave a row", async () => {
        const o = await owner("al-refusals");
        const stingy = await makeRuntime(admin, {
          limit: async (key) =>
            key.endsWith(":min")
              ? { allowed: false, retryAfter: 4 }
              : { allowed: true, retryAfter: 0 },
        });
        await stingy.call("list_pages", {}, who(o));
        await stingy.flush();
        const normal = await makeRuntime(admin);
        await normal.call(
          "add_block",
          { pageId: o.pageId, type: "header" },
          { ...who(o), scopes: ["hydlnk.read"] },
        );
        await normal.call("add_block", { pageId: o.pageId, type: "banana" }, who(o));
        await normal.call("get_page", { pageId: "00000000-0000-4000-8000-000000000001" }, who(o));
        await admin
          .from("accounts")
          .update({ suspended_at: new Date().toISOString() })
          .eq("id", o.userId);
        await normal.call("list_pages", {}, who(o));
        await normal.flush();
        const rows = (
          await admin
            .from("mcp_activity")
            .select("error_code, ok")
            .eq("user_id", o.userId)
            .order("id")
        ).data!;
        expect(rows.map((item) => item.error_code)).toEqual([
          "rate_limited",
          "insufficient_scope",
          "invalid_input",
          "not_found",
          "account_suspended",
        ]);
        expect(rows.every((item) => item.ok === false)).toBe(true);
      });

      it("a failed insert never changes the tool's result and is logged by code", async () => {
        const o = await owner("al-fail");
        const broken = await makeRuntime(admin, {
          recordActivity: async () => {
            throw new Error("insert failed: leaked-secret");
          },
        });
        const out = await broken.call("list_pages", {}, who(o));
        expect(out.isError).toBe(false);
        await broken.flush();
        expect(broken.logs.join("\n")).not.toContain("leaked-secret");
      });
    });
  },
);
