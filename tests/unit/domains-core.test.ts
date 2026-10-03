import { describe, expect, it } from "vitest";
import {
  addDomain,
  checkDomain,
  getDomainView,
  listDomainViews,
  removeDomain,
  setDomainPage,
} from "@/lib/domains/core";
import { VercelApiError } from "@/lib/domains/vercel-client";
import { IDS, domainRow, harness } from "./domains-fakes";

/**
 * M4-11, M4-12, M4-17: the add, remove and "Serves" logic against an in-memory database (unique
 * hostname and plan limit enforced like the real triggers) and a recording Vercel client. The
 * database-level limit and the real unique constraint are proven against Postgres in
 * supabase/tests/database/110-domains.test.sql and tests/e2e/m4/domains-core-db.spec.ts.
 */

const add = (h: ReturnType<typeof harness>, userId: string, hostname: unknown, pageId: unknown) =>
  addDomain(h.deps, userId, { hostname, pageId });

describe("M4-11 adding a domain", () => {
  it("inserts one pending row, makes exactly one add request and returns a card with its records", async () => {
    const h = harness();
    const result = await add(h, IDS.pro, "LINKS.Example.Test.", IDS.proPage);
    expect(result.ok).toBe(true);
    expect(h.admin.state.domains).toHaveLength(1);
    expect(h.admin.state.domains[0]).toMatchObject({
      hostname: "links.example.test",
      page_id: IDS.proPage,
      status: "pending",
      verified_at: null,
    });
    expect(h.vercel.count("add")).toBe(1);
    expect(h.vercel.calls[0]).toEqual({ fn: "add", host: "links.example.test" });
    if (!result.ok) return;
    expect(result.domain).toMatchObject({
      hostname: "links.example.test",
      pageId: IDS.proPage,
      status: "pending",
      verifiedAt: null,
      records: [{ type: "CNAME", name: "links", value: "abc123.vercel-dns-017.com" }],
      apex: { name: "example.test", ipv4: "203.0.113.10" },
      recordsUnavailable: false,
    });
    expect(h.expired).toEqual([IDS.proPage]);
  });

  it("stores an internationalised name in punycode", async () => {
    const h = harness();
    await add(h, IDS.pro, "bücher.example", IDS.proPage);
    expect(h.admin.state.domains[0]!.hostname).toBe("xn--bcher-kva.example");
  });

  it.each([
    "https://links.example.test",
    "links.example.test/page",
    "links.example.test:3000",
    "links example.test",
    "*.example.test",
    "localhost",
    "203.0.113.5",
    "a_b.example.test",
    `${"a".repeat(64)}.example.test`,
    `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.example.test`,
    "hydlnk.com",
    "www.hydlnk.com",
    "mara.hydlnk.com",
    "HYDLNK.COM",
    "app.localhost",
    "foo.vercel.app",
  ])("refuses %s with 400 invalid_hostname, no row and no Vercel call", async (input) => {
    const h = harness();
    const result = await add(h, IDS.pro, input, IDS.proPage);
    expect(result).toMatchObject({ ok: false, error: "invalid_hostname", status: 400 });
    expect(h.admin.state.domains).toHaveLength(0);
    expect(h.vercel.calls).toEqual([]);
  });

  it("refuses a missing or malformed page id with 400 invalid_request", async () => {
    const h = harness();
    for (const pageId of [undefined, "", "not-a-uuid", 7, null]) {
      expect(await add(h, IDS.pro, "links.example.test", pageId)).toMatchObject({
        ok: false,
        error: "invalid_request",
        status: 400,
      });
    }
    expect(h.vercel.calls).toEqual([]);
  });

  it("refuses a caller that is not a user id", async () => {
    const h = harness();
    expect(await add(h, "nobody", "links.example.test", IDS.proPage)).toMatchObject({ error: "unauthenticated", status: 401 });
    expect(h.vercel.calls).toEqual([]);
  });
});

describe("M4-11 uniqueness: one hostname, one page, never two", () => {
  it("adding it again, from the same account, is 409 hostname_taken with no Vercel call", async () => {
    const h = harness();
    await add(h, IDS.studio, "links.example.test", IDS.studioPage);
    h.vercel.calls.length = 0;
    expect(await add(h, IDS.studio, "Links.Example.Test", IDS.studioPage)).toEqual({
      ok: false,
      error: "hostname_taken",
      message: "That domain is already connected to a page.",
      status: 409,
    });
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(1);
  });

  it("and from another account", async () => {
    const h = harness();
    await add(h, IDS.studio, "links.example.test", IDS.studioPage);
    h.vercel.calls.length = 0;
    expect(await add(h, IDS.pro, "links.example.test", IDS.proPage)).toMatchObject({ error: "hostname_taken", status: 409 });
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(1);
  });

  it("two simultaneous adds of one hostname create exactly one row (Vercel refuses the second)", async () => {
    const h = harness();
    const results = await Promise.all([
      add(h, IDS.studio, "race.example.test", IDS.studioPage),
      add(h, IDS.pro, "race.example.test", IDS.proPage),
    ]);
    expect(h.admin.state.domains.filter((d) => d.hostname === "race.example.test")).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok)!;
    // The loser is told the domain is connected, not that Vercel failed.
    expect(loser).toMatchObject({ ok: false, error: "hostname_taken" });
    // And Vercel still holds the winner's domain: nothing removed it.
    expect(h.vercel.count("remove")).toBe(0);
    expect(h.vercel.state("race.example.test").added).toBe(true);
  });

  it("when Vercel lets both adds through, the unique constraint makes the loser hostname_taken and the winner's domain is never removed", async () => {
    const h = harness();
    // A Vercel that answers 200 to both (it is idempotent for a name this account added earlier).
    h.vercel.addProjectDomain = async (host: string) => {
      h.vercel.calls.push({ fn: "add", host });
      await Promise.resolve();
      return { name: host, apexName: "example.test", verified: false, verification: [] };
    };
    const results = await Promise.all([
      add(h, IDS.studio, "race2.example.test", IDS.studioPage),
      add(h, IDS.pro, "race2.example.test", IDS.proPage),
    ]);
    expect(h.admin.state.domains.filter((d) => d.hostname === "race2.example.test")).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "hostname_taken" });
    expect(h.vercel.count("remove")).toBe(0);
  });
});

describe("M4-11 plan gate and ownership", () => {
  it("a Free account gets 403 plan_required and Vercel sees nothing", async () => {
    const h = harness();
    expect(await add(h, IDS.free, "links.example.test", IDS.freePage)).toEqual({
      ok: false,
      error: "plan_required",
      message: "Custom domains start on Pro.",
      status: 403,
    });
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(0);
  });

  it("a Pro account submitting another account's page id gets 403 and nothing is created", async () => {
    const h = harness();
    expect(await add(h, IDS.pro, "links.example.test", IDS.otherPage)).toMatchObject({
      ok: false,
      error: "forbidden",
      status: 403,
    });
    expect(await add(h, IDS.pro, "links.example.test", "00000000-0000-4000-8000-00000000dead")).toMatchObject({
      error: "forbidden",
    });
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(0);
  });

  it("a suspended account cannot add, set a page or remove", async () => {
    const h = harness({
      suspended: [IDS.pro],
      domains: [domainRow({ id: "00000000-0000-4000-8000-0000000000d1", hostname: "s.example.test", page_id: IDS.proPage })],
    });
    expect(await add(h, IDS.pro, "links.example.test", IDS.proPage)).toMatchObject({ error: "account_suspended", status: 403 });
    expect(await setDomainPage(h.deps, IDS.pro, "00000000-0000-4000-8000-0000000000d1", IDS.proPage2)).toMatchObject({ error: "account_suspended" });
    expect(await removeDomain(h.deps, IDS.pro, "00000000-0000-4000-8000-0000000000d1")).toMatchObject({ error: "account_suspended" });
    expect(h.vercel.calls).toEqual([]);
  });
});

describe("M4-12 the domain limit (Free 0, Pro 1, Studio 15) with its words", () => {
  it("a Pro account adds one domain and fails on the second, with the Studio nudge", async () => {
    const h = harness();
    expect((await add(h, IDS.pro, "one.example.test", IDS.proPage)).ok).toBe(true);
    h.vercel.calls.length = 0;
    expect(await add(h, IDS.pro, "two.example.test", IDS.proPage2)).toEqual({
      ok: false,
      error: "domain_limit",
      message: "You’ve used 1 of 1 custom domains. Studio includes 15.",
      status: 403,
    });
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(1);
  });

  it("a Studio account adds 15 and fails on the 16th", async () => {
    const h = harness();
    for (let i = 1; i <= 15; i++) {
      expect((await add(h, IDS.studio, `d${i}.example.test`, IDS.studioPage)).ok).toBe(true);
    }
    h.vercel.calls.length = 0;
    expect(await add(h, IDS.studio, "d16.example.test", IDS.studioPage)).toEqual({
      ok: false,
      error: "domain_limit",
      message: "You’ve used 15 of 15 custom domains.",
      status: 403,
    });
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(15);
  });

  it("removing one frees a slot immediately", async () => {
    const h = harness();
    const first = await add(h, IDS.pro, "one.example.test", IDS.proPage);
    expect(first.ok).toBe(true);
    expect(await add(h, IDS.pro, "two.example.test", IDS.proPage)).toMatchObject({ error: "domain_limit" });
    if (first.ok) expect((await removeDomain(h.deps, IDS.pro, first.domain!.id)).ok).toBe(true);
    expect((await add(h, IDS.pro, "two.example.test", IDS.proPage)).ok).toBe(true);
  });

  it("two simultaneous adds of different names at 0 of 1 produce one row; the loser's name is taken off Vercel again", async () => {
    const h = harness();
    const results = await Promise.all([
      add(h, IDS.pro, "x1.example.test", IDS.proPage),
      add(h, IDS.pro, "x2.example.test", IDS.proPage2),
    ]);
    expect(h.admin.state.domains).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "domain_limit", status: 403 });
    const loserHost = ["x1.example.test", "x2.example.test"].find(
      (name) => !h.admin.state.domains.some((d) => d.hostname === name),
    )!;
    expect(h.vercel.calls.filter((c) => c.fn === "remove")).toEqual([{ fn: "remove", host: loserHost }]);
  });
});

describe("M4-11 Vercel failures leave no orphan", () => {
  it.each([
    ["a 5xx or a timeout", new VercelApiError("unavailable", 500, null, "x"), "vercel_unavailable", 502, "We couldn’t reach our host to add that domain. Try again."],
    ["a domain in use elsewhere", new VercelApiError("conflict", 409, "domain_already_in_use", "x"), "vercel_conflict", 409, "That domain is already connected elsewhere on our host. Contact support."],
    ["the Hobby 50-domain cap", new VercelApiError("capacity", 400, "too_many_domains", "x"), "vercel_capacity", 503, "We can’t add more domains right now. Try again later."],
  ])("%s leaves no row and says so", async (_name, error, code, status, message) => {
    const h = harness();
    h.vercel.addError = error;
    expect(await add(h, IDS.pro, "links.example.test", IDS.proPage)).toEqual({ ok: false, error: code, message, status });
    expect(h.admin.state.domains).toHaveLength(0);
    expect(h.vercel.count("remove")).toBe(0);
  });

  it("a Vercel that is not configured fails closed with a plain message", async () => {
    const h = harness();
    const notConfigured = new Error("Vercel is not configured: VERCEL_API_TOKEN is not set.");
    notConfigured.name = "VercelNotConfiguredError";
    h.vercel.addProjectDomain = async () => {
      throw notConfigured;
    };
    const result = await add(h, IDS.pro, "links.example.test", IDS.proPage);
    expect(result).toMatchObject({ ok: false, error: "not_configured", status: 503 });
    expect(JSON.stringify(result)).not.toMatch(/VERCEL_API_TOKEN/);
    expect(h.admin.state.domains).toHaveLength(0);
  });

  it("a database error after a successful Vercel add triggers the compensating remove", async () => {
    const h = harness();
    h.admin.state.failNextInsert = { code: "XX000", message: "forced database error" };
    const result = await add(h, IDS.pro, "links.example.test", IDS.proPage);
    expect(result).toMatchObject({ ok: false, error: "server_error", status: 500 });
    expect(h.admin.state.domains).toHaveLength(0);
    expect(h.vercel.calls).toEqual([
      { fn: "add", host: "links.example.test" },
      { fn: "remove", host: "links.example.test" },
    ]);
  });

  it("a failing compensating remove is logged and does not hide the original failure", async () => {
    const h = harness();
    h.admin.state.failNextInsert = { code: "XX000", message: "forced" };
    h.vercel.removeError = new VercelApiError("unavailable", 500, null, "x");
    expect(await add(h, IDS.pro, "links.example.test", IDS.proPage)).toMatchObject({ error: "server_error" });
    expect(h.logs.join("\n")).toMatch(/compensating remove failed/);
  });

  it("a failing config request after the add still adds the domain and shows 'records unavailable', no values", async () => {
    const h = harness();
    h.vercel.configError = new VercelApiError("unavailable", 500, null, "x");
    const result = await add(h, IDS.pro, "links.example.test", IDS.proPage);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.domain).toMatchObject({ records: [], recordsUnavailable: true, apex: null });
    expect(h.admin.state.domains).toHaveLength(1);
  });

  it("logs never carry a hostname-less secret: no token, no address", async () => {
    const h = harness();
    h.vercel.addError = new VercelApiError("unavailable", 500, null, "x");
    await add(h, IDS.pro, "links.example.test", IDS.proPage);
    expect(h.logs.join("\n")).not.toMatch(/pro@example|@/);
  });
});

describe("M4-15 / M4-17 ownership: another account's domain is a 404 and never reaches Vercel", () => {
  const OTHERS = "00000000-0000-4000-8000-0000000000d9";
  const base = () =>
    harness({ domains: [domainRow({ id: OTHERS, hostname: "theirs.example.test", page_id: IDS.otherPage })] });

  it("check, set page, remove, get", async () => {
    const h = base();
    expect(await checkDomain(h.deps, IDS.pro, OTHERS)).toMatchObject({ ok: false, error: "not_found", status: 404 });
    expect(await setDomainPage(h.deps, IDS.pro, OTHERS, IDS.proPage)).toMatchObject({ error: "not_found", status: 404 });
    expect(await removeDomain(h.deps, IDS.pro, OTHERS)).toMatchObject({ error: "not_found", status: 404 });
    expect(await getDomainView(h.deps, IDS.pro, OTHERS)).toBeNull();
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(1);
  });

  it("garbage ids are a 404 too", async () => {
    const h = base();
    for (const id of ["", "x", "../../etc", null, undefined, 3]) {
      expect(await checkDomain(h.deps, IDS.pro, id)).toMatchObject({ error: "not_found" });
      expect(await removeDomain(h.deps, IDS.pro, id)).toMatchObject({ error: "not_found" });
    }
    expect(h.vercel.calls).toEqual([]);
  });

  it("listing returns only the caller's domains", async () => {
    const h = harness({
      domains: [
        domainRow({ id: OTHERS, hostname: "theirs.example.test", page_id: IDS.otherPage }),
        domainRow({ id: "00000000-0000-4000-8000-0000000000d8", hostname: "mine.example.test", page_id: IDS.proPage, status: "verified", verified_at: "2026-10-04T10:00:00Z" }),
      ],
    });
    const views = await listDomainViews(h.deps, IDS.pro);
    expect(views.map((v) => v.hostname)).toEqual(["mine.example.test"]);
    // A verified domain needs no Vercel call; the other account's was never read.
    expect(h.vercel.calls).toEqual([]);
  });
});

describe("M4-17 removing a domain", () => {
  const ID = "00000000-0000-4000-8000-0000000000d1";
  const seeded = () =>
    harness({ domains: [domainRow({ id: ID, hostname: "gone.example.test", page_id: IDS.proPage })] });

  it("removes it at Vercel first and then deletes the row, and expires the page's cache", async () => {
    const h = seeded();
    expect(await removeDomain(h.deps, IDS.pro, ID)).toEqual({ ok: true });
    expect(h.vercel.calls).toEqual([{ fn: "remove", host: "gone.example.test" }]);
    expect(h.admin.state.domains).toHaveLength(0);
    expect(h.expired).toEqual([IDS.proPage]);
  });

  it("a Vercel failure keeps the row and says so", async () => {
    const h = seeded();
    h.vercel.removeError = new VercelApiError("unavailable", 500, null, "x");
    expect(await removeDomain(h.deps, IDS.pro, ID)).toMatchObject({
      ok: false,
      error: "vercel_unavailable",
      message: "We couldn’t remove that domain from our host. Try again.",
    });
    expect(h.admin.state.domains).toHaveLength(1);
    expect(h.expired).toEqual([]);
  });
});

describe("the Serves select", () => {
  const ID = "00000000-0000-4000-8000-0000000000d1";
  it("points a domain at another of the caller's pages and expires both pages", async () => {
    const h = harness({ domains: [domainRow({ id: ID, hostname: "s.example.test", page_id: IDS.proPage, status: "verified", verified_at: "2026-10-04T10:00:00Z" })] });
    const result = await setDomainPage(h.deps, IDS.pro, ID, IDS.proPage2);
    expect(result.ok).toBe(true);
    expect(h.admin.state.domains[0]!.page_id).toBe(IDS.proPage2);
    expect([...h.expired].sort()).toEqual([IDS.proPage, IDS.proPage2].sort());
    expect(h.vercel.calls).toEqual([]);
  });

  it("refuses a page that is not the caller's and changes nothing", async () => {
    const h = harness({ domains: [domainRow({ id: ID, hostname: "s.example.test", page_id: IDS.proPage })] });
    expect(await setDomainPage(h.deps, IDS.pro, ID, IDS.otherPage)).toMatchObject({ error: "forbidden", status: 403 });
    expect(await setDomainPage(h.deps, IDS.pro, ID, "nope")).toMatchObject({ error: "invalid_request", status: 400 });
    expect(h.admin.state.domains[0]!.page_id).toBe(IDS.proPage);
  });
});

describe("M4-13 reading the screen's domains", () => {
  it("a pending domain's records come fresh from Vercel on every read; a failing config says unavailable with no values", async () => {
    const ID = "00000000-0000-4000-8000-0000000000d1";
    const h = harness({ domains: [domainRow({ id: ID, hostname: "links.example.test", page_id: IDS.proPage })] });
    const first = await getDomainView(h.deps, IDS.pro, ID);
    expect(first!.records[0]).toMatchObject({ type: "CNAME", value: "abc123.vercel-dns-017.com" });
    h.vercel.state("links.example.test").cname = [{ rank: 1, value: "new999.vercel-dns-001.com." }];
    expect((await getDomainView(h.deps, IDS.pro, ID))!.records[0]!.value).toBe("new999.vercel-dns-001.com");
    h.vercel.configError = new VercelApiError("unavailable", 500, null, "x");
    expect(await getDomainView(h.deps, IDS.pro, ID)).toMatchObject({ records: [], recordsUnavailable: true, apex: null });
  });
});
