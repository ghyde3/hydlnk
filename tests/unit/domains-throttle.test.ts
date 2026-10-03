import { describe, expect, it, vi } from "vitest";
import { addDomain, listDomainViews, removeDomain } from "@/lib/domains/core";
import { DOMAIN_MESSAGES } from "@/lib/domains/messages";
import { IDS, domainRow, harness } from "./domains-fakes";

/** Per-account throttle on the actions that call Vercel, and the short memo of the records read. */

const D1 = "00000000-0000-4000-8000-0000000000d1";
const D2 = "00000000-0000-4000-8000-0000000000d2";

/** A limiter that allows `allowed` calls per key, then blocks with retryAfter 30. */
function limiter(allowed: number) {
  const counts = new Map<string, number>();
  const fn = vi.fn(async (key: string) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n <= allowed ? { allowed: true, retryAfter: 0 } : { allowed: false, retryAfter: 30 };
  });
  return fn;
}

describe("domains:add and domains:remove are throttled per account", () => {
  it("add uses domains:add:<userId> at 10 per 60 seconds", async () => {
    const h = harness();
    const rateLimit = limiter(100);
    h.deps.rateLimit = rateLimit;
    await addDomain(h.deps, IDS.pro, { hostname: "links.example.test", pageId: IDS.proPage });
    expect(rateLimit).toHaveBeenCalledWith(`domains:add:${IDS.pro}`, 10, 60);
  });

  it("an add over the limit is refused with a friendly message and never reaches Vercel or the database", async () => {
    const h = harness();
    h.deps.rateLimit = limiter(0);
    const result = await addDomain(h.deps, IDS.pro, { hostname: "links.example.test", pageId: IDS.proPage });
    expect(result).toEqual({
      ok: false,
      error: "rate_limited",
      message: DOMAIN_MESSAGES.rateLimited,
      status: 429,
    });
    expect(DOMAIN_MESSAGES.rateLimited).toBe("You’ve tried that a lot in a short time. Wait a minute and try again.");
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toEqual([]);
  });

  it("the 11th add in a minute is the first one refused", async () => {
    const h = harness({ domains: [] });
    h.deps.rateLimit = limiter(10);
    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(await addDomain(h.deps, IDS.pro, { hostname: `bad host ${i}`, pageId: IDS.proPage }));
    }
    // Invalid names are refused before the limiter (no Vercel call, nothing to protect); use valid ones.
    expect(results.every((r) => !r.ok && r.error === "invalid_hostname")).toBe(true);
    const h2 = harness();
    h2.deps.rateLimit = limiter(10);
    const codes: string[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await addDomain(h2.deps, IDS.pro, { hostname: `d${i}.example.test`, pageId: IDS.proPage });
      codes.push(r.ok ? "ok" : r.error);
    }
    expect(codes.slice(0, 10)).not.toContain("rate_limited");
    expect(codes[10]).toBe("rate_limited");
  });

  it("remove uses domains:remove:<userId> at 10 per 60 seconds, and a throttled remove keeps the row and skips Vercel", async () => {
    const h = harness({ domains: [domainRow({ id: D1, hostname: "gone.example.test", page_id: IDS.proPage })] });
    const rateLimit = limiter(0);
    h.deps.rateLimit = rateLimit;
    const result = await removeDomain(h.deps, IDS.pro, D1);
    expect(rateLimit).toHaveBeenCalledWith(`domains:remove:${IDS.pro}`, 10, 60);
    expect(result).toMatchObject({ ok: false, error: "rate_limited", status: 429 });
    expect(h.vercel.calls).toEqual([]);
    expect(h.admin.state.domains).toHaveLength(1);
  });

  it("the buckets are per account and per action", async () => {
    const h = harness({ domains: [domainRow({ id: D1, hostname: "gone.example.test", page_id: IDS.proPage })] });
    const rateLimit = limiter(100);
    h.deps.rateLimit = rateLimit;
    await removeDomain(h.deps, IDS.pro, D1);
    await addDomain(h.deps, IDS.other, { hostname: "x.example.test", pageId: IDS.otherPage });
    expect(rateLimit.mock.calls.map((c) => c[0])).toEqual([`domains:remove:${IDS.pro}`, `domains:add:${IDS.other}`]);
  });

  it("another account's id never consumes the owner's bucket or reaches Vercel", async () => {
    const h = harness({ domains: [domainRow({ id: D1, hostname: "theirs.example.test", page_id: IDS.otherPage })] });
    h.deps.rateLimit = limiter(100);
    const result = await removeDomain(h.deps, IDS.pro, D1);
    expect(result).toMatchObject({ error: "not_found" });
    expect(h.vercel.calls).toEqual([]);
  });

  it("with no limiter wired the actions still work (the unit harness default)", async () => {
    const h = harness();
    const result = await addDomain(h.deps, IDS.pro, { hostname: "links.example.test", pageId: IDS.proPage });
    expect(result.ok).toBe(true);
  });
});

describe("listDomainViews memoizes the per-domain Vercel reads briefly", () => {
  it("reloading the screen does not fire the two GETs again within the window, and does after it", async () => {
    const h = harness({
      domains: [
        domainRow({ id: D1, hostname: "one.example.test", page_id: IDS.proPage }),
        domainRow({ id: D2, hostname: "two.example.test", page_id: IDS.proPage }),
      ],
    });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
      const first = await listDomainViews(h.deps, IDS.pro);
      expect(h.vercel.calls).toHaveLength(4);
      h.vercel.calls.length = 0;

      vi.setSystemTime(new Date("2026-10-04T12:00:05Z"));
      const second = await listDomainViews(h.deps, IDS.pro);
      expect(h.vercel.calls).toEqual([]);
      expect(second).toEqual(first);

      vi.setSystemTime(new Date("2026-10-04T12:00:30Z"));
      await listDomainViews(h.deps, IDS.pro);
      expect(h.vercel.calls).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unavailable read is not remembered", async () => {
    const h = harness({ domains: [domainRow({ id: D1, hostname: "one.example.test", page_id: IDS.proPage })] });
    h.vercel.projectError = new (await import("@/lib/domains/vercel-client")).VercelApiError("unavailable", 502, null, "x");
    const first = await listDomainViews(h.deps, IDS.pro);
    expect(first[0]!.recordsUnavailable).toBe(true);
    h.vercel.projectError = null;
    const second = await listDomainViews(h.deps, IDS.pro);
    expect(second[0]!.recordsUnavailable).toBe(false);
  });

  it("a different Vercel client never shares the memo (no leak across deployments or tests)", async () => {
    const a = harness({ domains: [domainRow({ id: D1, hostname: "one.example.test", page_id: IDS.proPage })] });
    const b = harness({ domains: [domainRow({ id: D1, hostname: "one.example.test", page_id: IDS.proPage })] });
    await listDomainViews(a.deps, IDS.pro);
    await listDomainViews(b.deps, IDS.pro);
    expect(b.vercel.calls.length).toBe(2);
  });
});
