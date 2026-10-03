import { describe, expect, it, vi } from "vitest";
import { checkDomain } from "@/lib/domains/core";
import {
  CHECK_COOLDOWN_SECONDS,
  announceLive,
  readDomainRow,
  sweepPendingDomains,
  verifyDomain,
} from "@/lib/domains/verify";
import { createVercelClient } from "@/lib/domains/vercel-client";
import { VercelApiError } from "@/lib/domains/vercel-client";
import { IDS, domainRow, harness } from "./domains-fakes";

/**
 * M4-15 (check, cooldown, sweep, SSRF) and M5-23 (one email, never blocking) against an in-memory
 * database whose atomic functions behave like the SQL ones (pgTAP proves those) and a recording
 * Vercel client.
 */

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";
const host = (h: ReturnType<typeof harness>, id: string) =>
  h.admin.state.domains.find((d) => d.id === id)!;

function pending(h: ReturnType<typeof harness> | null, id = A, hostname = "links.example.test", extra = {}) {
  return domainRow({ id, hostname, page_id: IDS.proPage, ...extra });
}

describe("M4-15 Check DNS now", () => {
  it("flips a pending domain to verified when Vercel says verified and not misconfigured", async () => {
    const h = harness({ domains: [pending(null)] });
    h.vercel.state("links.example.test").verified = true;
    h.vercel.state("links.example.test").misconfigured = false;
    const result = await checkDomain(h.deps, IDS.pro, A);
    expect(result.ok && result.domain).toMatchObject({ status: "verified", hostname: "links.example.test" });
    expect(host(h, A)).toMatchObject({ status: "verified" });
    expect(host(h, A).verified_at).toBeTruthy();
    expect(h.expired).toEqual([IDS.proPage]);
  });

  it.each([
    ["unverified", { verified: false, misconfigured: false }],
    ["misconfigured", { verified: true, misconfigured: true }],
    ["both", { verified: false, misconfigured: true }],
  ])("stays pending when Vercel reports %s, with the 'DNS isn’t pointing here yet' line", async (_name, state) => {
    const h = harness({ domains: [pending(null)] });
    Object.assign(h.vercel.state("links.example.test"), state);
    const result = await checkDomain(h.deps, IDS.pro, A);
    expect(result.ok && result.domain).toMatchObject({
      status: "pending",
      message: "Checked just now. DNS isn’t pointing here yet. Records can take a while to spread.",
      records: [{ type: "CNAME", name: "links" }],
    });
    expect(host(h, A).status).toBe("pending");
    expect(h.emails).toEqual([]);
  });

  it("sets last_checked_at on every check", async () => {
    const h = harness({ domains: [pending(null)] });
    expect(host(h, A).last_checked_at).toBeNull();
    await checkDomain(h.deps, IDS.pro, A);
    expect(host(h, A).last_checked_at).toBeTruthy();
  });

  it("a Vercel failure leaves the row pending and says it could not reach the host", async () => {
    const h = harness({ domains: [pending(null)] });
    h.vercel.verifyError = new VercelApiError("unavailable", 500, null, "x");
    const result = await checkDomain(h.deps, IDS.pro, A);
    expect(result.ok && result.domain).toMatchObject({
      status: "pending",
      message: "We couldn’t check right now. Try again in a minute.",
      recordsUnavailable: true,
    });
    expect(host(h, A).status).toBe("pending");
  });
});

describe("M4-15 cooldown: one Vercel verify request per ten seconds", () => {
  it("a second check within 10 seconds returns the stored result with 'Checked a few seconds ago.' and makes no verify request", async () => {
    const h = harness({ domains: [pending(null)] });
    await checkDomain(h.deps, IDS.pro, A);
    expect(h.vercel.count("verify")).toBe(1);
    h.admin.advance(4_000);
    const second = await checkDomain(h.deps, IDS.pro, A);
    expect(second.ok && second.domain).toMatchObject({
      status: "pending",
      message: "Checked a few seconds ago.",
      records: [{ type: "CNAME", name: "links", value: "abc123.vercel-dns-017.com" }],
    });
    expect(h.vercel.count("verify")).toBe(1);
  });

  it("after the cooldown the next check is a real one", async () => {
    const h = harness({ domains: [pending(null)] });
    await checkDomain(h.deps, IDS.pro, A);
    h.admin.advance(CHECK_COOLDOWN_SECONDS * 1000 + 1);
    await checkDomain(h.deps, IDS.pro, A);
    expect(h.vercel.count("verify")).toBe(2);
  });

  it("20 rapid checks produce at most one verify request", async () => {
    const h = harness({ domains: [pending(null)] });
    const results = await Promise.all(Array.from({ length: 20 }, () => checkDomain(h.deps, IDS.pro, A)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(h.vercel.count("verify")).toBe(1);
    expect(h.admin.state.rpcLog.filter((c) => c.name === "claim_domain_check")).toHaveLength(20);
  });

  it("a cooled-down result never answers 'verified' for a domain that is not", async () => {
    const h = harness({ domains: [pending(null)] });
    const [a, b] = await Promise.all([checkDomain(h.deps, IDS.pro, A), checkDomain(h.deps, IDS.pro, A)]);
    for (const r of [a, b]) expect(r.ok && r.domain!.status).toBe("pending");
  });

  it("a domain flipped by someone else meanwhile is returned as verified, with no verify request", async () => {
    const h = harness({ domains: [pending(null, A, "links.example.test", { status: "verified", verified_at: "2026-10-04T10:00:00Z" })] });
    const result = await checkDomain(h.deps, IDS.pro, A);
    expect(result.ok && result.domain).toMatchObject({ status: "verified", records: [] });
    expect(h.vercel.calls).toEqual([]);
  });
});

describe("M4-15 SSRF guard: only ever the Vercel API host", () => {
  it("check, poll and sweep make requests to the API host only and never to the customer's hostname", async () => {
    const h = harness({
      domains: [
        pending(null, A, "links.example.test"),
        pending(null, B, "evil.attacker.test"),
      ],
    });
    const urls: string[] = [];
    const spy = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url.href);
      if (url.pathname.endsWith("/config")) {
        return new Response(JSON.stringify({ misconfigured: true, recommendedCNAME: [{ rank: 1, value: "t.vercel-dns.example." }], recommendedIPv4: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: "x", apexName: "attacker.test", verified: false, verification: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const real = createVercelClient({ token: "tok_unit_ssrf", projectId: "prj", teamId: "team", baseUrl: "https://api.vercel.example" }, spy);
    const deps = { ...h.deps, vercel: real };

    await checkDomain(deps, IDS.pro, A);
    await verifyDomain(deps, B, { cooldownSeconds: 0 });
    await sweepPendingDomains(deps, { now: () => new Date("2026-10-04T12:00:00Z") });

    expect(urls.length).toBeGreaterThan(3);
    for (const href of urls) {
      expect(new URL(href).host).toBe("api.vercel.example");
      expect(new URL(href).hostname).not.toMatch(/example\.test|attacker/);
    }
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });
});

describe("M5-23 the domain-live email", () => {
  it("is sent once, to the page owner's address from auth (never from a request), when a domain flips", async () => {
    const h = harness({ domains: [pending(null)] });
    h.vercel.state("links.example.test").verified = true;
    h.vercel.state("links.example.test").misconfigured = false;
    await checkDomain(h.deps, IDS.pro, A);
    expect(h.emails).toEqual([{ to: "pro@example.test", hostname: "links.example.test" }]);
    expect(host(h, A).live_email_sent_at).toBeTruthy();
  });

  it("concurrent verifications (two tabs, the sweep and a manual check) produce one message", async () => {
    const h = harness({ domains: [pending(null)] });
    h.vercel.state("links.example.test").verified = true;
    h.vercel.state("links.example.test").misconfigured = false;
    await Promise.all([
      verifyDomain(h.deps, A, { cooldownSeconds: 0 }),
      verifyDomain(h.deps, A, { cooldownSeconds: 0 }),
      checkDomain(h.deps, IDS.pro, A),
      sweepPendingDomains(h.deps, { now: () => new Date("2026-10-04T12:00:00Z") }),
      verifyDomain(h.deps, A, { cooldownSeconds: 0, withRecords: false }),
    ]);
    expect(h.emails).toHaveLength(1);
    expect(h.admin.state.rpcLog.filter((c) => c.name === "claim_domain_live_email").length).toBeLessThanOrEqual(5);
  });

  it("announcing twice sends one message", async () => {
    const h = harness({ domains: [pending(null, A, "links.example.test", { status: "verified", verified_at: "2026-10-04T10:00:00Z" })] });
    const row = (await readDomainRow(h.deps, A))!;
    await announceLive(h.deps, row);
    await announceLive(h.deps, row);
    expect(h.emails).toHaveLength(1);
  });

  it("a domain that is already verified, a pending one and a removed one send nothing", async () => {
    const h = harness({
      domains: [
        pending(null, A, "done.example.test", { status: "verified", verified_at: "2026-10-04T10:00:00Z", live_email_sent_at: "2026-10-04T10:00:01Z" }),
        pending(null, B, "waiting.example.test"),
      ],
    });
    // Already verified and already announced: verifying it again does not announce again.
    await verifyDomain(h.deps, A, { cooldownSeconds: 0 });
    // Pending: announcing is refused by the claim (status must be verified).
    await announceLive(h.deps, (await readDomainRow(h.deps, B))!);
    // Removed: there is no row to verify.
    expect(await verifyDomain(h.deps, "00000000-0000-4000-8000-0000000000ff")).toBeNull();
    expect(h.emails).toEqual([]);
  });

  it("a send failure never blocks verification, and the log never carries the address", async () => {
    const h = harness({
      domains: [pending(null)],
      sendLiveEmail: async () => {
        throw new Error("SMTP exploded for pro@example.test");
      },
    });
    h.vercel.state("links.example.test").verified = true;
    h.vercel.state("links.example.test").misconfigured = false;
    const result = await checkDomain(h.deps, IDS.pro, A);
    expect(result.ok && result.domain!.status).toBe("verified");
    expect(host(h, A).status).toBe("verified");
    expect(h.logs.join("\n")).toMatch(/live email for domain/);
    expect(h.logs.join("\n")).not.toContain("pro@example.test");
  });

  it("a suspended owner's page is not announced as live", async () => {
    const h = harness({ domains: [pending(null)], suspended: [IDS.pro] });
    h.vercel.state("links.example.test").verified = true;
    h.vercel.state("links.example.test").misconfigured = false;
    await verifyDomain(h.deps, A, { cooldownSeconds: 0 });
    expect(host(h, A).status).toBe("verified");
    expect(h.emails).toEqual([]);
  });
});

describe("M4-15 the five-minute sweep", () => {
  const NOW = new Date("2026-10-04T12:00:00Z");
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it("with two pending domains and one verified at Vercel, one call flips exactly that row and reports {checked, verified}", async () => {
    const h = harness({
      domains: [pending(null, A, "one.example.test", { created_at: days(1) }), pending(null, B, "two.example.test", { created_at: days(1) })],
    });
    h.vercel.state("one.example.test").verified = true;
    h.vercel.state("one.example.test").misconfigured = false;
    const result = await sweepPendingDomains(h.deps, { now: () => NOW });
    expect(result).toEqual({ checked: 2, verified: 1 });
    expect(host(h, A).status).toBe("verified");
    expect(host(h, B).status).toBe("pending");
    expect(h.emails).toEqual([{ to: "pro@example.test", hostname: "one.example.test" }]);
  });

  it("skips a pending domain created 8 days earlier (Check DNS now can still verify it)", async () => {
    const h = harness({
      domains: [pending(null, A, "old.example.test", { created_at: days(8) }), pending(null, B, "new.example.test", { created_at: days(6) })],
    });
    const result = await sweepPendingDomains(h.deps, { now: () => NOW });
    expect(result.checked).toBe(1);
    expect(h.vercel.calls.some((c) => c.host === "old.example.test")).toBe(false);

    // The same old domain verifies through Check DNS now.
    h.vercel.state("old.example.test").verified = true;
    h.vercel.state("old.example.test").misconfigured = false;
    const manual = await checkDomain(h.deps, IDS.pro, A);
    expect(manual.ok && manual.domain!.status).toBe("verified");
  });

  it("takes at most 50, least recently checked first (never-checked first)", async () => {
    const domains = Array.from({ length: 60 }, (_, i) => {
      const id = `00000000-0000-4000-8000-${String(100000 + i).padStart(12, "0")}`;
      // 0..9 never checked; the rest checked at increasing times: lower i = checked earlier.
      return pending(null, id, `d${i}.example.test`, {
        created_at: days(1),
        last_checked_at: i < 10 ? null : new Date(NOW.getTime() - 3_600_000 + i * 1_000).toISOString(),
      });
    });
    const h = harness({ domains });
    const result = await sweepPendingDomains(h.deps, { now: () => NOW });
    expect(result.checked).toBe(50);
    const checked = new Set(h.vercel.calls.filter((c) => c.fn === "verify").map((c) => c.host));
    expect(checked.size).toBe(50);
    // The ten never-checked ones are in, the ten most recently checked are not.
    for (let i = 0; i < 10; i++) expect(checked.has(`d${i}.example.test`)).toBe(true);
    for (let i = 50; i < 60; i++) expect(checked.has(`d${i}.example.test`)).toBe(false);
  });

  it("uses the same cooldown: a domain checked moments ago is not asked again and is not counted", async () => {
    const h = harness({ domains: [pending(null, A, "one.example.test", { created_at: days(1) })] });
    await checkDomain(h.deps, IDS.pro, A);
    h.vercel.calls.length = 0;
    const result = await sweepPendingDomains(h.deps, { now: () => NOW });
    expect(result).toEqual({ checked: 0, verified: 0 });
    expect(h.vercel.count("verify")).toBe(0);
  });

  it("one failing domain never stops the others", async () => {
    const h = harness({
      domains: [pending(null, A, "bad.example.test", { created_at: days(1) }), pending(null, B, "good.example.test", { created_at: days(1) })],
    });
    const original = h.vercel.verifyProjectDomain.bind(h.vercel);
    h.vercel.verifyProjectDomain = async (name: string) => {
      if (name === "bad.example.test") throw new Error("boom");
      return original(name);
    };
    h.vercel.state("good.example.test").verified = true;
    h.vercel.state("good.example.test").misconfigured = false;
    const result = await sweepPendingDomains(h.deps, { now: () => NOW });
    expect(result.verified).toBe(1);
    expect(host(h, B).status).toBe("verified");
  });

  it("verified and errored-out domains are not listed, and an empty table answers zero", async () => {
    const h = harness({ domains: [pending(null, A, "v.example.test", { status: "verified", verified_at: days(1), created_at: days(1) })] });
    expect(await sweepPendingDomains(h.deps, { now: () => NOW })).toEqual({ checked: 0, verified: 0 });
    expect(h.vercel.calls).toEqual([]);
  });
});
