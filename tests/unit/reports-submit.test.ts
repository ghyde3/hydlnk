import { describe, expect, it, vi } from "vitest";
import {
  REPORT_GLOBAL_KEY,
  REPORT_GLOBAL_RATE,
  reporterHashes,
  submitReport,
  type ReportDeps,
} from "@/lib/reports";

/**
 * M5-05: the submission flow with stand-in dependencies: what happens in which order, and what the
 * visitor is told. The real limiter and filing are SQL (pgTAP) and the HTTP behaviour is in the
 * Playwright specs.
 */
const PAGE = "00000000-0000-4000-8000-0000000000b1";
const NOW = new Date("2026-10-03T12:00:00Z");
const IP = "203.0.113.7";
const valid = {
  page: PAGE,
  reason: "phishing",
  details: "Fake login page.",
  email: "me@example.com",
};

function makeDeps(overrides: Partial<ReportDeps> = {}) {
  const deps: ReportDeps = {
    secret: "secret",
    rootDomain: "localhost:3000",
    now: () => NOW,
    findPageById: vi.fn(async (id: string) => (id === PAGE ? { id: PAGE, handle: "mara" } : null)),
    findPageByAddress: vi.fn(async (address) =>
      address.kind === "handle" && address.handle === "mara" ? { id: PAGE, handle: "mara" } : null,
    ),
    limiter: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
    store: vi.fn(async () => "created" as const),
    ...overrides,
  };
  return deps;
}

const SENT = { ok: true, message: "Report sent. We’ll review it." };

describe("M5-05 submitReport", () => {
  it("files a report for a page id and says it was sent", async () => {
    const deps = makeDeps();
    const outcome = await submitReport(valid, IP, deps);
    expect(outcome).toEqual({ status: 200, body: SENT });
    expect(deps.store).toHaveBeenCalledTimes(1);
    expect(deps.store).toHaveBeenCalledWith({
      pageId: PAGE,
      pageHandle: "mara",
      reason: "phishing",
      details: "Fake login page.",
      email: "me@example.com",
      hashes: reporterHashes(IP, "secret", NOW),
      pageCap: 25,
    });
  });

  it("stores no raw IP anywhere: only the two hashes reach the store and the limiter", async () => {
    const deps = makeDeps();
    await submitReport(valid, IP, deps);
    const seen = JSON.stringify([
      vi.mocked(deps.store).mock.calls,
      vi.mocked(deps.limiter).mock.calls,
    ]);
    expect(seen).not.toContain(IP);
    expect(vi.mocked(deps.store).mock.calls[0]![0].hashes).toHaveLength(2);
  });

  it("finds a page by handle address", async () => {
    const deps = makeDeps();
    const outcome = await submitReport(
      { address: "https://mara.hydlnk.com/", reason: "spam" },
      IP,
      deps,
    );
    expect(outcome.status).toBe(200);
    expect(deps.findPageByAddress).toHaveBeenCalledWith({ kind: "handle", handle: "mara" });
    expect(deps.store).toHaveBeenCalledTimes(1);
  });

  it("a filled honeypot answers success and does nothing at all (not even counted)", async () => {
    for (const value of ["http://spam.example", "x", " y "]) {
      const deps = makeDeps();
      expect(await submitReport({ ...valid, company_url: value }, IP, deps)).toEqual({
        status: 200,
        body: SENT,
      });
      expect(deps.limiter).not.toHaveBeenCalled();
      expect(deps.findPageById).not.toHaveBeenCalled();
      expect(deps.store).not.toHaveBeenCalled();
    }
    // An empty honeypot is how a real visitor arrives.
    const deps = makeDeps();
    await submitReport({ ...valid, company_url: "" }, IP, deps);
    expect(deps.store).toHaveBeenCalledTimes(1);
    // A honeypot sent as a non-string (a script posting JSON) is still a trap.
    const other = makeDeps();
    await submitReport({ ...valid, company_url: 1 }, IP, other);
    expect(other.store).not.toHaveBeenCalled();
  });

  it("validation errors are 400 with the field named, and cost no limit, lookup or insert", async () => {
    const deps = makeDeps();
    const outcome = await submitReport(
      { ...valid, reason: "nope", details: "x".repeat(5000), email: "bad" },
      IP,
      deps,
    );
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({
      ok: false,
      errors: {
        reason: expect.any(String),
        details: expect.any(String),
        email: expect.any(String),
      },
    });
    expect(deps.limiter).not.toHaveBeenCalled();
    expect(deps.findPageById).not.toHaveBeenCalled();
    expect(deps.store).not.toHaveBeenCalled();
  });

  it("an unknown page is a 404 on the field the visitor used, with the address message", async () => {
    const byId = makeDeps();
    const unknownId = await submitReport(
      { ...valid, page: "11111111-1111-4111-8111-111111111111" },
      IP,
      byId,
    );
    expect(unknownId).toEqual({
      status: 404,
      body: { ok: false, errors: { page: "We couldn’t find that page. Check the address." } },
    });
    expect(byId.store).not.toHaveBeenCalled();

    const byAddress = makeDeps();
    const unknown = await submitReport(
      { address: "nobody.hydlnk.com", reason: "spam" },
      IP,
      byAddress,
    );
    expect(unknown).toEqual({
      status: 404,
      body: { ok: false, errors: { address: "We couldn’t find that page. Check the address." } },
    });
    expect(byAddress.store).not.toHaveBeenCalled();
  });

  it("an address that cannot name a page is the same 404 without a lookup or a count", async () => {
    const deps = makeDeps();
    const outcome = await submitReport({ address: "app.hydlnk.com", reason: "spam" }, IP, deps);
    expect(outcome.status).toBe(404);
    expect(deps.findPageByAddress).not.toHaveBeenCalled();
    expect(deps.limiter).not.toHaveBeenCalled();
  });

  it("a refused report says Too many reports with a Retry-After, and files nothing", async () => {
    const deps = makeDeps({ limiter: vi.fn(async () => ({ allowed: false, retryAfter: 1234.2 })) });
    const outcome = await submitReport(valid, IP, deps);
    expect(outcome.status).toBe(429);
    expect(outcome.body).toEqual({ ok: false, message: "Too many reports. Try again later." });
    expect(outcome.headers).toEqual({ "Retry-After": "1235" });
    expect(deps.findPageById).not.toHaveBeenCalled();
    expect(deps.store).not.toHaveBeenCalled();
  });

  it("counts before it looks the page up, with 5 per hour for this reporter", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      limiter: vi.fn(async () => (order.push("limit"), { allowed: true, retryAfter: 0 })),
      findPageById: vi.fn(async () => (order.push("lookup"), { id: PAGE, handle: "mara" })),
      store: vi.fn(async () => (order.push("store"), "created" as const)),
    });
    await submitReport(valid, IP, deps);
    expect(order).toEqual(["limit", "lookup", "limit", "store"]); // the reporter, the page, the whole form, then the store
    expect(deps.limiter).toHaveBeenCalledWith(reporterHashes(IP, "secret", NOW), 5, 3600);
  });

  it("a repeat inside 24 hours and a flooded page read exactly like a filed report", async () => {
    for (const result of ["duplicate", "page_capped"] as const) {
      const deps = makeDeps({ store: vi.fn(async () => result) });
      expect(await submitReport(valid, IP, deps)).toEqual({ status: 200, body: SENT });
    }
  });

  it("the 6th report in the hour from one IP is the one refused, another IP is unaffected", async () => {
    // A stand-in with the same rule as report_rate_limit_hit: 5 counted per key, then refuse.
    const counts = new Map<string, number>();
    const limiter: ReportDeps["limiter"] = async (hashes, limit) => {
      const used = counts.get(hashes[0]!) ?? 0;
      if (used >= limit) return { allowed: false, retryAfter: 60 };
      counts.set(hashes[0]!, used + 1);
      return { allowed: true, retryAfter: 0 };
    };
    const deps = makeDeps({ limiter, store: vi.fn(async () => "duplicate" as const) });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await submitReport(valid, IP, deps)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await submitReport(valid, "198.51.100.9", deps)).status).toBe(200);
  });

  it("an error from a dependency propagates (the handler turns it into a 500, never into a success)", async () => {
    const deps = makeDeps({
      store: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(submitReport(valid, IP, deps)).rejects.toThrow("db down");
    const limiter = makeDeps({
      limiter: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(submitReport(valid, IP, limiter)).rejects.toThrow("db down");
  });

  it("a whole IPv6 /64 is one reporter: addresses in it share the limit, the hash and the duplicate rule", async () => {
    const seen: string[][] = [];
    const deps = makeDeps({
      limiter: vi.fn(async (hashes) => (seen.push(hashes), { allowed: true, retryAfter: 0 })),
    });
    await submitReport(valid, "2001:db8:1:2:aaaa:bbbb:cccc:dddd", deps);
    await submitReport(valid, "2001:DB8:1:2::1", deps);
    await submitReport(valid, "2001:db8:1:3::1", deps);
    const reporter = seen.filter((hashes) => hashes[0] !== REPORT_GLOBAL_KEY);
    expect(reporter[0]).toEqual(reporter[1]);
    expect(reporter[0]).not.toEqual(reporter[2]);
    expect(reporter[0]).toEqual(reporterHashes("2001:db8:1:2::/64", "secret", NOW));
    // The store sees the same two hashes, so a duplicate from the same /64 is a duplicate.
    expect(vi.mocked(deps.store).mock.calls[0]![0].hashes).toEqual(reporter[0]);
    expect(vi.mocked(deps.store).mock.calls[1]![0].hashes).toEqual(reporter[0]);
  });

  it("the 6th report from one /64 is refused however the address changes inside it", async () => {
    const counts = new Map<string, number>();
    const limiter: ReportDeps["limiter"] = async (hashes, limit) => {
      const used = counts.get(hashes[0]!) ?? 0;
      if (used >= limit) return { allowed: false, retryAfter: 60 };
      counts.set(hashes[0]!, used + 1);
      return { allowed: true, retryAfter: 0 };
    };
    const deps = makeDeps({ limiter, store: vi.fn(async () => "created" as const) });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await submitReport(valid, `2001:db8:77:9:${i.toString(16)}::${i + 1}`, deps)).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await submitReport(valid, "2001:db8:77:a::1", deps)).status).toBe(200);
  });

  it("the whole form has an hourly cap too: refused with the same message once it is full, nothing is filed, and a refused reporter never touches it", async () => {
    const keys: string[][] = [];
    const limiter: ReportDeps["limiter"] = async (hashes, limit, window) => {
      keys.push(hashes);
      if (hashes[0] === REPORT_GLOBAL_KEY) {
        expect([limit, window]).toEqual([
          REPORT_GLOBAL_RATE.limit,
          REPORT_GLOBAL_RATE.windowSeconds,
        ]);
        return { allowed: false, retryAfter: 600 };
      }
      return { allowed: true, retryAfter: 0 };
    };
    const full = makeDeps({ limiter });
    const outcome = await submitReport(valid, IP, full);
    expect(outcome).toMatchObject({
      status: 429,
      body: { ok: false, message: "Too many reports. Try again later." },
      headers: { "Retry-After": "600" },
    });
    expect(full.store).not.toHaveBeenCalled();

    keys.length = 0;
    const refused = makeDeps({
      limiter: vi.fn(async (hashes) => (keys.push(hashes), { allowed: false, retryAfter: 5 })),
    });
    expect((await submitReport(valid, IP, refused)).status).toBe(429);
    expect(keys).toHaveLength(1); // only the reporter's own limiter was asked
    expect(keys[0]![0]).not.toBe(REPORT_GLOBAL_KEY);
    expect(REPORT_GLOBAL_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(REPORT_GLOBAL_RATE.limit).toBeGreaterThan(5);
  });

  it("a report about a page that does not exist never touches the whole-form counter (anyone can send those in any number)", async () => {
    const keys: string[] = [];
    const deps = makeDeps({
      limiter: vi.fn(async (hashes) => (keys.push(hashes[0]!), { allowed: true, retryAfter: 0 })),
    });
    const outcome = await submitReport(
      { page: "00000000-0000-4000-8000-0000000000ff", reason: "spam" },
      IP,
      deps,
    );
    expect(outcome.status).toBe(404);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(REPORT_GLOBAL_KEY);
    expect(deps.store).not.toHaveBeenCalled();
  });
});
