import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeOwner, rand, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M4-18 (create a page within the plan's limit) and M4-19 (delete a page) against the local Supabase
 * stack: the real claim and delete cores with the secret-key client, the real BEFORE INSERT limit
 * triggers, the real cascade. Nothing here talks to the network except the local Vercel stub the
 * delete cases start in this file.
 */
const { run } = await stackIsUp();

type Plan = "free" | "pro" | "studio";

const ENV = (base: string): Record<string, string> => ({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "k",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test_value",
  VERCEL_API_TOKEN: "vercel-unit-token",
  VERCEL_PROJECT_ID: "prj_unit",
  VERCEL_TEAM_ID: "team_unit",
  VERCEL_API_BASE_URL: base,
});

interface StubRequest {
  method: string;
  path: string;
  teamId: string | null;
  authorization: string | undefined;
}

/** A local stand-in for the Vercel REST API: records every request, answers `respond(hostname)`. */
async function startVercelStub() {
  const requests: StubRequest[] = [];
  let respond: (hostname: string) => number = () => 200;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    requests.push({
      method: req.method ?? "",
      path: url.pathname,
      teamId: url.searchParams.get("teamId"),
      authorization: req.headers.authorization,
    });
    const hostname = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    res.statusCode = respond(hostname);
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    requests,
    respondWith: (fn: (hostname: string) => number) => {
      respond = fn;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe.skipIf(!run)(
  "M4-18 / M4-19 pages: create within the limit, delete (local Supabase)",
  () => {
    let admin: SupabaseClient;
    let createPageWithClient: typeof import("@/lib/pages/create-page-core").createPageWithClient;
    let deletePageWithClient: typeof import("@/lib/pages/delete-page-core").deletePageWithClient;
    // The real remover: the shared Vercel client (src/lib/domains) on a config read from `source`.
    let removeVercelDomain: (
      hostname: string,
      fetchImpl: typeof fetch,
      source: Record<string, string | undefined>,
    ) => Promise<void>;
    let stub: Awaited<ReturnType<typeof startVercelStub>>;
    const owners: TestOwner[] = [];

    beforeAll(async () => {
      const { createClient } = await import("@supabase/supabase-js");
      admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        {
          auth: { persistSession: false },
        },
      );
      ({ createPageWithClient } = await import("@/lib/pages/create-page-core"));
      ({ deletePageWithClient } = await import("@/lib/pages/delete-page-core"));
      const { createVercelClient } = await import("@/lib/domains/vercel-client");
      const { readVercelApiConfig } = await import("@/lib/pages/vercel-config");
      removeVercelDomain = async (hostname, fetchImpl, source) =>
        createVercelClient(readVercelApiConfig(source), fetchImpl).removeProjectDomain(hostname);
      stub = await startVercelStub();
    });

    afterAll(async () => {
      await removeOwners(admin, owners);
      await stub?.close();
    });

    async function owner(label: string, plan: Plan = "free") {
      const made = await makeOwner(admin, label, undefined, plan);
      owners.push(made);
      return made;
    }

    const create = (o: TestOwner, handle: string) =>
      createPageWithClient(admin as never, o.userId, handle);

    const handleOf = (label: string) => `zq-${label}-${rand(5)}`;

    const countPages = async (userId: string) => {
      const { count, error } = await admin
        .from("pages")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId);
      expect(error).toBeNull();
      return count ?? 0;
    };

    const pageExists = async (pageId: string) => {
      const { data, error } = await admin.from("pages").select("id").eq("id", pageId).maybeSingle();
      expect(error).toBeNull();
      return data !== null;
    };

    // -------------------------------------------------------------------------------------------
    // M4-18
    // -------------------------------------------------------------------------------------------

    it("M4-18 a Pro account creates pages 2 and 3, the 4th fails with 403 page_limit and creates nothing", async () => {
      const o = await owner("pr", "pro");
      const second = await create(o, handleOf("pr2"));
      const third = await create(o, handleOf("pr3"));
      expect(second.ok).toBe(true);
      expect(third.ok).toBe(true);
      expect(await countPages(o.userId)).toBe(3);

      const fourth = await create(o, handleOf("pr4"));
      expect(fourth).toMatchObject({
        ok: false,
        status: 403,
        error: "page_limit",
        message: "You’ve used 3 of 3 sites. Studio includes 15.",
      });
      expect(await countPages(o.userId)).toBe(3);
    });

    it("M4-18 deleting a page frees the slot immediately", async () => {
      const o = await owner("fr", "pro");
      const second = await create(o, handleOf("fr2"));
      await create(o, handleOf("fr3"));
      expect((await create(o, handleOf("fr4"))).ok).toBe(false);

      if (!second.ok) throw new Error("setup: the second page was not created");
      const removed = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: second.pageId, confirm: second.handle },
        { removeDomain: async () => undefined },
      );
      expect(removed.ok).toBe(true);
      expect(await countPages(o.userId)).toBe(2);

      const again = await create(o, handleOf("fr5"));
      expect(again.ok).toBe(true);
      expect(await countPages(o.userId)).toBe(3);
    });

    it("M4-18 a Free account's second page is refused with 'Free includes 1 site. Pro includes 3.'", async () => {
      const o = await owner("fe", "free");
      const refused = await create(o, handleOf("fe2"));
      expect(refused).toMatchObject({
        ok: false,
        status: 403,
        error: "page_limit",
        message: "Free includes 1 site. Pro includes 3.",
      });
      expect(await countPages(o.userId)).toBe(1);
    });

    it("M4-18 a Studio account's 15th page succeeds and its 16th fails with 'You’ve used 15 of 15 sites.'", async () => {
      const o = await owner("st", "studio");
      for (let n = 2; n <= 15; n++) {
        const made = await create(o, handleOf(`st${n}`));
        expect(made.ok, `page ${n}`).toBe(true);
      }
      expect(await countPages(o.userId)).toBe(15);

      const sixteenth = await create(o, handleOf("st16"));
      expect(sixteenth).toMatchObject({
        ok: false,
        status: 403,
        error: "page_limit",
        message: "You’ve used 15 of 15 sites.",
      });
      expect(await countPages(o.userId)).toBe(15);
    });

    it("M4-18 simultaneous creates at 2 of 3 yield exactly one new row", async () => {
      const o = await owner("cc", "pro");
      expect((await create(o, handleOf("cc2"))).ok).toBe(true);

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => create(o, handleOf(`cc${i}x`))),
      );
      const accepted = results.filter((r) => r.ok);
      const refused = results.filter((r) => !r.ok);
      expect(accepted).toHaveLength(1);
      expect(refused).toHaveLength(5);
      for (const r of refused) {
        expect(r).toMatchObject({ status: 403, error: "page_limit" });
      }
      expect(await countPages(o.userId)).toBe(3);
    });

    it("M4-18 the page is created with an empty draft, unpublished, owned by the session user", async () => {
      const o = await owner("dr", "pro");
      const handle = handleOf("dr2");
      const made = await create(o, handle);
      if (!made.ok) throw new Error("setup: create failed");
      expect(made.handle).toBe(handle);

      const { data, error } = await admin
        .from("pages")
        .select("owner_id, handle, draft, published, published_at")
        .eq("id", made.pageId)
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({
        owner_id: o.userId,
        handle,
        published: null,
        published_at: null,
      });
      expect(data?.draft).toMatchObject({ version: 1, blocks: [] });
    });

    it("M4-18 the claim rules apply: reserved, taken, short, too long and invalid handles create nothing", async () => {
      const a = await owner("ru", "pro");
      const b = await owner("rv", "pro");
      const before = await countPages(a.userId);

      const www = await create(a, "www");
      expect(www).toMatchObject({ ok: false, status: 422, error: "reserved" });
      expect(await create(a, "WWW")).toMatchObject({ ok: false, error: "reserved" });
      expect(await create(a, "ab")).toMatchObject({ ok: false, status: 422, error: "short" });
      expect(await create(a, "a".repeat(40))).toMatchObject({
        ok: false,
        status: 422,
        error: "too_long",
      });
      expect(await create(a, "xn--punycode")).toMatchObject({
        ok: false,
        status: 422,
        error: "invalid",
      });
      expect(await create(a, "-lead-dash")).toMatchObject({
        ok: false,
        status: 422,
        error: "invalid",
      });
      // Someone else's handle is taken, whatever its case.
      expect(await create(a, b.handle.toUpperCase())).toMatchObject({
        ok: false,
        status: 409,
        error: "taken",
      });
      // The account's own page counts as taken too.
      expect(await create(a, a.handle)).toMatchObject({ ok: false, status: 409, error: "taken" });
      expect(await countPages(a.userId)).toBe(before);
    });

    it("M4-18 racing for one handle: exactly one account gets it", async () => {
      const a = await owner("ra", "pro");
      const b = await owner("rb", "pro");
      const handle = handleOf("race");
      const [x, y] = await Promise.all([create(a, handle), create(b, handle)]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      const loser = x.ok ? y : x;
      expect(loser).toMatchObject({ ok: false, status: 409, error: "taken" });
      const { count } = await admin
        .from("pages")
        .select("id", { count: "exact", head: true })
        .eq("handle", handle);
      expect(count).toBe(1);
    });

    it("M4-18 a suspended account and a user without an account cannot create", async () => {
      const o = await owner("su", "pro");
      await admin
        .from("accounts")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", o.userId);
      const refused = await create(o, handleOf("su2"));
      expect(refused).toMatchObject({
        ok: false,
        status: 403,
        error: "suspended",
        message: "This account can’t create sites.",
      });
      expect(await countPages(o.userId)).toBe(1);

      const ghost = await createPageWithClient(
        admin as never,
        "00000000-0000-4000-8000-00000000dead",
        handleOf("gh"),
      );
      expect(ghost).toMatchObject({ ok: false, status: 403, error: "no_account" });
    });

    // -------------------------------------------------------------------------------------------
    // M4-19
    // -------------------------------------------------------------------------------------------

    const NO_REMOVAL = { removeDomain: async () => undefined };

    async function secondPage(o: TestOwner, label: string) {
      const made = await create(o, handleOf(label));
      if (!made.ok) throw new Error(`setup: ${made.error}`);
      return made;
    }

    async function addDomain(pageId: string, hostname: string) {
      const { error } = await admin.from("domains").insert({
        page_id: pageId,
        hostname,
        status: "verified",
        verified_at: new Date().toISOString(),
      });
      if (error) throw new Error(`setup domain: ${error.message}`);
    }

    it("M4-19 deleting your own page removes it, its domains and events; your other pages stay", async () => {
      const o = await owner("dl", "pro");
      const page = await secondPage(o, "dl2");
      const host = `${rand(8)}.dl.example.com`;
      await addDomain(page.pageId, host);
      expect(
        (
          await admin
            .from("events")
            .insert({ page_id: page.pageId, type: "view", visitor_hash: "unit-visitor" })
        ).error,
      ).toBeNull();

      // The hosting project is told first: while removeDomain runs the page row still exists.
      const seenDuringRemoval: boolean[] = [];
      const removed: string[] = [];
      const result = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: page.pageId, confirm: page.handle },
        {
          removeDomain: async (hostname) => {
            seenDuringRemoval.push(await pageExists(page.pageId));
            removed.push(hostname);
          },
        },
      );

      expect(result).toEqual({
        ok: true,
        pageId: page.pageId,
        handle: page.handle,
        remaining: 1,
      });
      expect(removed).toEqual([host]);
      expect(seenDuringRemoval).toEqual([true]);
      expect(await pageExists(page.pageId)).toBe(false);
      expect(await pageExists(o.pageId)).toBe(true);

      const rowsLeft = await Promise.all([
        admin
          .from("domains")
          .select("id", { count: "exact", head: true })
          .eq("page_id", page.pageId),
        admin
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("page_id", page.pageId),
      ]);
      // (daily_stats rows cascade too; no client role may insert them, so pgTAP 092 proves that part.)
      expect(rowsLeft.map((r) => r.count)).toEqual([0, 0]);

      // The handle is free again: a new page can claim it.
      const reclaimed = await create(o, page.handle);
      expect(reclaimed.ok).toBe(true);
    });

    it("M4-19 deleting the last page leaves the account with none (remaining 0)", async () => {
      const o = await owner("lp", "free");
      const result = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: o.pageId, confirm: o.handle },
        NO_REMOVAL,
      );
      expect(result).toMatchObject({ ok: true, remaining: 0 });
      expect(await countPages(o.userId)).toBe(0);
    });

    it("M4-19 another account's page id is a 404 and nothing is deleted or removed upstream", async () => {
      const victim = await owner("vi", "pro");
      const attacker = await owner("at", "pro");
      await addDomain(victim.pageId, `${rand(8)}.victim.example.com`);
      const removeDomain = vi.fn(async () => undefined);

      const result = await deletePageWithClient(
        admin as never,
        { userId: attacker.userId, pageId: victim.pageId, confirm: victim.handle },
        { removeDomain },
      );
      expect(result).toMatchObject({ ok: false, status: 404, error: "not_found" });
      expect(removeDomain).not.toHaveBeenCalled();
      expect(await pageExists(victim.pageId)).toBe(true);
      const domains = await admin
        .from("domains")
        .select("id", { count: "exact", head: true })
        .eq("page_id", victim.pageId);
      expect(domains.count).toBe(1);
    });

    it("M5-09 a suspended owner cannot delete a page: 403 account_suspended, nothing is removed upstream or deleted, the suspension stays; unsuspended, the same call works", async () => {
      const o = await owner("sd", "pro");
      const extra = await secondPage(o, "sd2");
      await addDomain(extra.pageId, `${rand(8)}.suspended.example.com`);
      const stamp = new Date().toISOString();
      await admin.from("accounts").update({ suspended_at: stamp }).eq("id", o.userId);
      const removeDomain = vi.fn(async () => undefined);

      const refused = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: extra.pageId, confirm: extra.handle },
        { removeDomain },
      );
      expect(refused).toMatchObject({ ok: false, status: 403, error: "account_suspended" });
      expect(removeDomain).not.toHaveBeenCalled();
      expect(await pageExists(extra.pageId)).toBe(true);
      expect(await pageExists(o.pageId)).toBe(true);
      const account = await admin
        .from("accounts")
        .select("suspended_at")
        .eq("id", o.userId)
        .single();
      expect(account.data?.suspended_at).not.toBeNull();

      // Not even a malformed id or a wrong confirmation gets past the suspension check first.
      const malformed = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: "nope", confirm: "x" },
        { removeDomain },
      );
      expect(malformed).toMatchObject({ ok: false, status: 403, error: "account_suspended" });

      await admin.from("accounts").update({ suspended_at: null }).eq("id", o.userId);
      const allowed = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: extra.pageId, confirm: extra.handle },
        { removeDomain },
      );
      expect(allowed).toMatchObject({ ok: true, handle: extra.handle });
      expect(await pageExists(extra.pageId)).toBe(false);
    });

    it("M5-09 a user with no account row, and a failed account read, also cannot delete a page", async () => {
      const o = await owner("sg", "pro");
      const ghost = await deletePageWithClient(
        admin as never,
        { userId: "00000000-0000-4000-8000-00000000dead", pageId: o.pageId, confirm: o.handle },
        NO_REMOVAL,
      );
      expect(ghost).toMatchObject({ ok: false, status: 403, error: "account_suspended" });
      expect(await pageExists(o.pageId)).toBe(true);

      const broken = {
        from: (table: string) => {
          if (table !== "accounts")
            return (admin as never as { from: (t: string) => unknown }).from(table);
          const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: async () => ({ data: null, error: { message: "down" } }),
          };
          return chain;
        },
      };
      const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const failed = await deletePageWithClient(
        broken as never,
        { userId: o.userId, pageId: o.pageId, confirm: o.handle },
        NO_REMOVAL,
      );
      quiet.mockRestore();
      expect(failed).toMatchObject({ ok: false, status: 500, error: "delete_failed" });
      expect(await pageExists(o.pageId)).toBe(true);
    });

    it("M4-19 an unknown, malformed or non-string page id is a 404", async () => {
      const o = await owner("ma", "free");
      for (const pageId of [
        "00000000-0000-4000-8000-00000000dead",
        "not-a-uuid",
        "",
        "' or 1=1 --",
        undefined,
        null,
        42,
        { id: o.pageId },
        [o.pageId],
      ]) {
        const result = await deletePageWithClient(
          admin as never,
          { userId: o.userId, pageId, confirm: o.handle },
          NO_REMOVAL,
        );
        expect(result, JSON.stringify(pageId)).toMatchObject({
          ok: false,
          status: 404,
          error: "not_found",
        });
      }
      expect(await pageExists(o.pageId)).toBe(true);
    });

    it("M4-19 a wrong or missing confirmation is rejected server-side and deletes nothing", async () => {
      const o = await owner("cf", "pro");
      const page = await secondPage(o, "cf2");
      const removeDomain = vi.fn(async () => undefined);
      for (const confirm of [
        "",
        "wrong",
        page.handle.toUpperCase(),
        ` ${page.handle}`,
        `${page.handle} `,
        `${page.handle}.hydlnk.com`,
        o.handle,
        undefined,
        null,
        42,
        [page.handle],
      ]) {
        const result = await deletePageWithClient(
          admin as never,
          { userId: o.userId, pageId: page.pageId, confirm },
          { removeDomain },
        );
        expect(result, JSON.stringify(confirm)).toMatchObject({
          ok: false,
          status: 400,
          error: "confirmation_mismatch",
        });
      }
      expect(removeDomain).not.toHaveBeenCalled();
      expect(await pageExists(page.pageId)).toBe(true);
    });

    it("M4-19 a domain that cannot be removed aborts the whole delete: the page and every domain row stay, and a retry succeeds", async () => {
      const o = await owner("df", "studio");
      const page = await secondPage(o, "df2");
      const first = `${rand(8)}.first.example.com`;
      const second = `${rand(8)}.second.example.com`;
      await addDomain(page.pageId, first);
      await addDomain(page.pageId, second);

      let failing = true;
      const attempts: string[] = [];
      const deps = {
        removeDomain: async (hostname: string) => {
          attempts.push(hostname);
          if (failing && hostname === second) throw new Error("Vercel is down");
        },
      };
      const input = { userId: o.userId, pageId: page.pageId, confirm: page.handle };

      const failed = await deletePageWithClient(admin as never, input, deps);
      expect(failed).toEqual({
        ok: false,
        status: 502,
        error: "domain_removal_failed",
        message: "Couldn’t remove its custom domain. Try again.",
      });
      expect(await pageExists(page.pageId)).toBe(true);
      const rows = await admin.from("domains").select("hostname").eq("page_id", page.pageId);
      expect(rows.data?.map((r) => r.hostname).sort()).toEqual([first, second].sort());

      // The retry starts clean (removing an already removed hostname is a no-op upstream).
      failing = false;
      const retried = await deletePageWithClient(admin as never, input, deps);
      expect(retried).toMatchObject({ ok: true, handle: page.handle });
      expect(await pageExists(page.pageId)).toBe(false);
      expect(attempts.filter((h) => h === first).length).toBeGreaterThanOrEqual(2);
    });

    // The real remover against a local Vercel stub (never api.vercel.com).

    it("M4-19 removeVercelDomain sends DELETE /v9/projects/{project}/domains/{hostname}?teamId with the bearer token", async () => {
      stub.requests.length = 0;
      stub.respondWith(() => 200);
      await removeVercelDomain("links.example.com", fetch, ENV(stub.base));
      expect(stub.requests).toEqual([
        {
          method: "DELETE",
          path: "/v9/projects/prj_unit/domains/links.example.com",
          teamId: "team_unit",
          authorization: "Bearer vercel-unit-token",
        },
      ]);
    });

    it("M4-19 a hostname the project no longer has (404) counts as removed; any other failure throws", async () => {
      stub.respondWith(() => 404);
      await expect(
        removeVercelDomain("gone.example.com", fetch, ENV(stub.base)),
      ).resolves.toBeUndefined();
      for (const status of [400, 401, 403, 409, 429, 500, 503]) {
        stub.respondWith(() => status);
        await expect(
          removeVercelDomain("fail.example.com", fetch, ENV(stub.base)),
          `HTTP ${status}`,
        ).rejects.toThrow(String(status));
      }
    });

    it("M4-19 an unreachable host and a missing token or project fail closed", async () => {
      await expect(
        removeVercelDomain("a.example.com", fetch, ENV("http://127.0.0.1:1")),
      ).rejects.toThrow();
      const noToken = { ...ENV(stub.base), VERCEL_API_TOKEN: "" };
      await expect(removeVercelDomain("a.example.com", fetch, noToken)).rejects.toThrow(
        /not configured/,
      );
      const noProject = { ...ENV(stub.base), VERCEL_PROJECT_ID: "" };
      await expect(removeVercelDomain("a.example.com", fetch, noProject)).rejects.toThrow(
        /not configured/,
      );
    });

    it("M4-19 a page delete through the real remover and the stub: the stub is asked once per domain, then the row goes", async () => {
      const o = await owner("rs", "studio");
      const page = await secondPage(o, "rs2");
      const hosts = [`${rand(8)}.one.example.com`, `${rand(8)}.two.example.com`];
      for (const host of hosts) await addDomain(page.pageId, host);

      stub.requests.length = 0;
      stub.respondWith(() => 200);
      const done = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: page.pageId, confirm: page.handle },
        { removeDomain: (hostname) => removeVercelDomain(hostname, fetch, ENV(stub.base)) },
      );
      expect(done.ok).toBe(true);
      expect(stub.requests.map((r) => r.path).sort()).toEqual(
        hosts.map((h) => `/v9/projects/prj_unit/domains/${h}`).sort(),
      );
      expect(await pageExists(page.pageId)).toBe(false);

      // And with the stub failing, the page and its rows stay.
      const again = await secondPage(o, "rs3");
      const host = `${rand(8)}.three.example.com`;
      await addDomain(again.pageId, host);
      stub.respondWith(() => 500);
      const refused = await deletePageWithClient(
        admin as never,
        { userId: o.userId, pageId: again.pageId, confirm: again.handle },
        { removeDomain: (hostname) => removeVercelDomain(hostname, fetch, ENV(stub.base)) },
      );
      expect(refused).toMatchObject({ ok: false, status: 502, error: "domain_removal_failed" });
      expect(await pageExists(again.pageId)).toBe(true);
      const left = await admin.from("domains").select("hostname").eq("page_id", again.pageId);
      expect(left.data?.map((r) => r.hostname)).toEqual([host]);
    });
  },
);
