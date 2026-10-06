import { domainToASCII } from "node:url";
import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { untilHostLookupExpires } from "../fixtures/expire";
import { rawRequest } from "../fixtures/http";
import { requireLocalEnv } from "../fixtures/stripe-stub";
import { messagesTo, waitForMessages } from "../fixtures/mailpit";
import {
  addCalls,
  addPath,
  configPath,
  domainPath,
  forgetDomain,
  markDnsReady,
  removalCalls,
  requestsFor,
  setDomainState,
  vercelIds,
  verifyCalls,
  verifyPath,
} from "../fixtures/vercel-stub";
import { addDomain, checkDomain, listDomainViews, removeDomain, setDomainPage } from "@/lib/domains/core";
import {
  addDomainRow,
  domainRowOf,
  domainRowsFor,
  hostnameFor,
  makeSite,
  publishedPage,
  realDeps,
  resetCooldown,
} from "./domains-core-helpers";

/**
 * The domain logic (src/lib/domains/core.ts and verify.ts, the code the server actions call) driven
 * against the real Postgres and the local Vercel stub, so what the stub records and what the tables
 * hold is what production code does: M4-11 add, M4-12 limits, M4-13 records, M4-15 check and
 * cooldown, M4-17 remove, M5-23 the email. The server actions are the session check plus these
 * calls; the Domains screen (its own specs) drives them through the browser.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 150_000 });

const UNIQUE = () => hostnameFor("f");

async function noRequestsFor(host: string) {
  expect(await requestsFor(host)).toEqual([]);
}

test.describe("M4-11 add a custom domain through the Vercel Domains API", () => {
  test("M4-11 / M4-13 a Pro add makes exactly one add request with the project, team and bearer, stores one pending row and returns its records", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("fa", "pro");
    const host = UNIQUE();
    const deps = realDeps();
    const { project, team } = vercelIds();

    const result = await addDomain(deps, site.user.id, { hostname: host.toUpperCase() + ".", pageId: site.pageId });
    expect(result.ok).toBe(true);

    const adds = await addCalls(host);
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ method: "POST", path: addPath(), hasBearer: true, body: { name: host } });
    expect(adds[0]!.path).toBe(`/v10/projects/${project}/domains`);
    expect(adds[0]!.query.teamId).toBe(team);

    const rows = await adminClient().from("domains").select("hostname, page_id, status, verified_at, last_checked_at, live_email_sent_at").eq("hostname", host);
    expect(rows.data).toEqual([{ hostname: host, page_id: site.pageId, status: "pending", verified_at: null, last_checked_at: null, live_email_sent_at: null }]);

    if (!result.ok) return;
    const label = host.split(".")[0]!;
    expect(result.domain).toMatchObject({
      hostname: host,
      pageId: site.pageId,
      status: "pending",
      verifiedAt: null,
      records: [{ type: "CNAME", name: label, value: "abc123.vercel-dns-017.com" }],
      apex: { name: "example.test", ipv4: "203.0.113.10" },
      recordsUnavailable: false,
    });
    expect(deps.expired).toEqual([site.pageId]);

    // M4-13: the records are Vercel's: changing the stub changes what the next read shows, and a TXT challenge appears.
    await setDomainState(host, {
      recommendedCNAME: [{ rank: 1, value: "new456.vercel-dns-099.com." }],
      verification: [{ type: "TXT", domain: "_vercel.example.test", value: "vc-domain-verify=x,y", reason: "pending" }],
    });
    const [view] = await listDomainViews(deps, site.user.id);
    expect(view!.records).toEqual([
      { type: "CNAME", name: label, value: "new456.vercel-dns-099.com" },
      { type: "TXT", name: "_vercel", value: "vc-domain-verify=x,y" },
    ]);

    // The reads were GETs of the project domain and the config, never a verify.
    const reads = (await requestsFor(host)).filter((r) => r.method === "GET").map((r) => r.path);
    expect(reads).toContain(domainPath(host));
    expect(reads).toContain(configPath(host));
    expect(await verifyCalls(host)).toEqual([]);
  });

  test("M4-11 every invalid hostname is 400 invalid_hostname with no row and no Vercel call", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("fb", "pro");
    const deps = realDeps();
    const tag = `zq-inv-${rand(6)}`;
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${tag}.example.test`;
    const cases = [
      `https://${tag}.example.test`,
      `${tag}.example.test/page`,
      `${tag}.example.test:3000`,
      `${tag} example.test`,
      `*.${tag}.example.test`,
      "localhost",
      "203.0.113.5",
      `${tag.replace(/-/g, "_")}.example.test`,
      long,
      `${"a".repeat(64)}.${tag}.example.test`,
      "hydlnk.com",
      "www.hydlnk.com",
      "mara.hydlnk.com",
      "HYDLNK.COM",
      "app.localhost",
      `${tag}.vercel.app`,
    ];
    for (const input of cases) {
      const result = await addDomain(deps, site.user.id, { hostname: input, pageId: site.pageId });
      expect(result, input).toMatchObject({ ok: false, error: "invalid_hostname", status: 400 });
    }
    const rows = await adminClient().from("domains").select("id").eq("page_id", site.pageId);
    expect(rows.data).toEqual([]);
    for (const input of [`${tag}.example.test`, `${tag}.vercel.app`]) await noRequestsFor(input);
    expect(await addCalls("hydlnk.com")).toEqual([]);
    expect(await addCalls("localhost")).toEqual([]);
  });

  test("M4-11 an internationalised name is stored and shown in punycode", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("fc", "pro");
    const typed = `zq${rand(5)}-bücher.example`;
    const expected = domainToASCII(typed);
    const result = await addDomain(realDeps(), site.user.id, { hostname: typed, pageId: site.pageId });
    expect(result.ok && result.domain!.hostname).toBe(expected);
    expect(expected.startsWith("xn--")).toBe(true);
    expect((await addCalls(expected))).toHaveLength(1);
  });

  test("M4-11 a hostname already connected, from the same or another account, is 409 hostname_taken with no Vercel call", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const first = await makeSite("fd1", "studio");
    const second = await makeSite("fd2", "pro");
    const host = UNIQUE();
    expect((await addDomain(realDeps(), first.user.id, { hostname: host, pageId: first.pageId })).ok).toBe(true);
    for (const [site, typed] of [[first, host], [second, host.toUpperCase()]] as const) {
      const again = await addDomain(realDeps(), site.user.id, { hostname: typed, pageId: site.pageId });
      expect(again).toEqual({ ok: false, error: "hostname_taken", message: "That domain is already connected to a site.", status: 409 });
    }
    expect(await addCalls(host)).toHaveLength(1);
    expect(await domainRowsFor(host)).toBe(1);
  });

  test("M4-11 plan gate and ownership: Free is 403 plan_required, another account's page is 403, the stub sees nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const free = await makeSite("fe1", "free");
    const pro = await makeSite("fe2", "pro");
    const host = UNIQUE();
    expect(await addDomain(realDeps(), free.user.id, { hostname: host, pageId: free.pageId })).toEqual({
      ok: false, error: "plan_required", message: "Custom domains start on Pro.", status: 403,
    });
    expect(await addDomain(realDeps(), pro.user.id, { hostname: host, pageId: free.pageId })).toMatchObject({ ok: false, error: "forbidden", status: 403 });
    expect(await domainRowsFor(host)).toBe(0);
    await noRequestsFor(host);
  });

  test("M4-11 Vercel failures leave no orphan: a 5xx, an 8-second timeout, a domain in use elsewhere and the Hobby cap", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("ff", "studio");
    const cases: { name: string; state: Parameters<typeof setDomainState>[1]; error: string; message: string }[] = [
      { name: "5xx", state: { addError: { status: 500, code: "internal" } }, error: "vercel_unavailable", message: "We couldn’t reach our host to add that domain. Try again." },
      { name: "conflict", state: { addError: { status: 409, code: "domain_already_in_use" } }, error: "vercel_conflict", message: "That domain is already connected elsewhere on our host. Contact support." },
      { name: "cap", state: { addError: { status: 400, code: "too_many_domains" } }, error: "vercel_capacity", message: "We can’t add more domains right now. Try again later." },
      { name: "timeout", state: { addDelayMs: 9_000 }, error: "vercel_unavailable", message: "We couldn’t reach our host to add that domain. Try again." },
    ];
    for (const c of cases) {
      const host = UNIQUE();
      await setDomainState(host, c.state);
      const started = Date.now();
      const result = await addDomain(realDeps(), site.user.id, { hostname: host, pageId: site.pageId });
      expect(result, c.name).toMatchObject({ ok: false, error: c.error, message: c.message });
      if (c.name === "timeout") expect(Date.now() - started).toBeLessThan(8_800);
      expect(await domainRowsFor(host), c.name).toBe(0);
      expect(await removalCalls(host), c.name).toEqual([]);
    }
  });

  test("M4-11 a database error after a successful Vercel add triggers a compensating remove request", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("fg", "pro");
    const host = UNIQUE();
    const real = adminClient();
    const failing = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const query = target.from(table);
          if (table !== "domains") return query;
          return new Proxy(query, {
            get(q, p, r) {
              if (p === "insert") {
                return () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "XX000", message: "forced database error" } }) }) });
              }
              return Reflect.get(q, p, r);
            },
          });
        };
      },
    });
    const deps = realDeps({ admin: failing as never });
    const result = await addDomain(deps, site.user.id, { hostname: host, pageId: site.pageId });
    expect(result).toMatchObject({ ok: false, error: "server_error", status: 500 });
    expect(await domainRowsFor(host)).toBe(0);
    expect(await addCalls(host)).toHaveLength(1);
    const removals = await removalCalls(host);
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({ hasBearer: true });
    expect(removals[0]!.query.teamId).toBe(vercelIds().team);
  });
});

test.describe("M4-12 the domain limit through the real logic", () => {
  test("M4-12 a Pro account adds one and fails on the second with the Studio nudge; removing one frees the slot", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("la", "pro");
    const first = UNIQUE();
    const second = UNIQUE();
    const added = await addDomain(realDeps(), site.user.id, { hostname: first, pageId: site.pageId });
    expect(added.ok).toBe(true);
    expect(await addDomain(realDeps(), site.user.id, { hostname: second, pageId: site.pageId })).toEqual({
      ok: false, error: "domain_limit", message: "You’ve used 1 of 1 custom domains. Studio includes 15.", status: 403,
    });
    await noRequestsFor(second);
    expect(await domainRowsFor(second)).toBe(0);

    if (added.ok) expect(await removeDomain(realDeps(), site.user.id, added.domain!.id)).toEqual({ ok: true });
    expect((await addDomain(realDeps(), site.user.id, { hostname: second, pageId: site.pageId })).ok).toBe(true);
  });

  test("M4-12 a Studio account adds 15 and fails on the 16th", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("lb", "studio");
    for (let i = 0; i < 15; i++) {
      const result = await addDomain(realDeps(), site.user.id, { hostname: hostnameFor(`s${i}`), pageId: site.pageId });
      expect(result.ok, `domain ${i + 1}`).toBe(true);
    }
    const sixteenth = hostnameFor("s16");
    expect(await addDomain(realDeps(), site.user.id, { hostname: sixteenth, pageId: site.pageId })).toEqual({
      ok: false, error: "domain_limit", message: "You’ve used 15 of 15 custom domains.", status: 403,
    });
    await noRequestsFor(sixteenth);
  });
});

test.describe("M4-15 Check DNS now, the cooldown and the live email", () => {
  test("M4-15 / M5-23 20 rapid checks make one verify request; when Vercel says ready the domain flips, serves at once and one email goes to the owner", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("ca", "pro");
    const host = UNIQUE();
    const added = await addDomain(realDeps(), site.user.id, { hostname: host, pageId: site.pageId });
    expect(added.ok).toBe(true);
    const id = added.ok ? added.domain!.id : "";

    const deps = realDeps();
    const burst = await Promise.all(Array.from({ length: 20 }, () => checkDomain(deps, site.user.id, id)));
    expect(burst.every((r) => r.ok)).toBe(true);
    expect((await verifyCalls(host)).length).toBe(1);
    const messages = burst.map((r) => (r.ok ? r.domain!.message : null));
    expect(messages).toContain("Checked just now. DNS isn’t pointing here yet. Records can take a while to spread.");
    expect(messages.filter((m) => m === "Checked a few seconds ago.").length).toBeGreaterThan(0);
    for (const r of burst) expect(r.ok && r.domain!.status).toBe("pending");
    expect((await domainRowOf(id))!.last_checked_at).toBeTruthy();
    expect((await rawRequest(host, "/")).status).toBe(404);

    // DNS becomes ready: five checks racing past the cooldown flip once and send one email.
    await markDnsReady(host);
    await resetCooldown(id);
    const race = await Promise.all(Array.from({ length: 5 }, () => checkDomain(realDeps(), site.user.id, id)));
    expect(race.some((r) => r.ok && r.domain!.status === "verified")).toBe(true);
    const row = (await domainRowOf(id))!;
    expect(row.status).toBe("verified");
    expect(row.verified_at).toBeTruthy();
    expect(row.live_email_sent_at).toBeTruthy();
    // The checks above ran in this process: a production build still holds the host's 10 s "none".
    const live = await untilHostLookupExpires(() => rawRequest(host, "/"), (r) => r.status === 200, "none");
    expect(live.status).toBe(200);

    const mail = await waitForMessages(site.user.email, 1);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.Subject).toBe(`${host} is live`);
    await new Promise((r) => setTimeout(r, 500));
    expect(await messagesTo(site.user.email)).toHaveLength(1);

    // A verified domain is returned as is: no more verify requests, no second email.
    const again = await checkDomain(realDeps(), site.user.id, id);
    expect(again.ok && again.domain).toMatchObject({ status: "verified", records: [] });
    expect((await verifyCalls(host)).length).toBeLessThanOrEqual(6);
    expect(await messagesTo(site.user.email)).toHaveLength(1);
  });

  test("M5-23 a send failure never blocks verification and the log never carries the address", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("cb", "pro");
    const host = UNIQUE();
    const added = await addDomain(realDeps(), site.user.id, { hostname: host, pageId: site.pageId });
    const id = added.ok ? added.domain!.id : "";
    await markDnsReady(host);
    const deps = realDeps({
      sendLiveEmail: async () => {
        throw new Error(`SMTP stub error for ${site.user.email}`);
      },
    });
    const result = await checkDomain(deps, site.user.id, id);
    expect(result.ok && result.domain!.status).toBe("verified");
    expect((await domainRowOf(id))!.status).toBe("verified");
    expect(deps.logs.join("\n")).toMatch(/live email for domain/);
    expect(deps.logs.join("\n")).not.toContain(site.user.email);
    expect(await messagesTo(site.user.email)).toHaveLength(0);
  });

  test("M4-15 another account's domain id is a 404 with no Vercel call, whichever action", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const mine = await makeSite("cc1", "pro");
    const theirs = await makeSite("cc2", "pro");
    const host = UNIQUE();
    const added = await addDomain(realDeps(), theirs.user.id, { hostname: host, pageId: theirs.pageId });
    const id = added.ok ? added.domain!.id : "";
    const before = (await requestsFor(host)).length;
    expect(await checkDomain(realDeps(), mine.user.id, id)).toMatchObject({ ok: false, error: "not_found", status: 404 });
    expect(await removeDomain(realDeps(), mine.user.id, id)).toMatchObject({ ok: false, error: "not_found", status: 404 });
    expect(await setDomainPage(realDeps(), mine.user.id, id, mine.pageId)).toMatchObject({ ok: false, error: "not_found" });
    expect((await requestsFor(host)).length).toBe(before);
    expect(await domainRowOf(id)).not.toBeNull();
  });

  test("M4-15 SSRF: the server's requests go to the Vercel API host only, in the API's own paths, never to the customer's hostname", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("cs", "pro");
    const host = UNIQUE();
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const deps = realDeps({ sendLiveEmail: async () => undefined });
      const added = await addDomain(deps, site.user.id, { hostname: host, pageId: site.pageId });
      const id = added.ok ? added.domain!.id : "";
      await checkDomain(deps, site.user.id, id);
      await markDnsReady(host);
      await resetCooldown(id);
      await checkDomain(deps, site.user.id, id);
      await removeDomain(deps, site.user.id, id);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen.length).toBeGreaterThanOrEqual(6);
    // The database client shares the global fetch; everything else goes to the Vercel API host.
    const databaseHost = new URL(requireLocalEnv("NEXT_PUBLIC_SUPABASE_URL")).host;
    const apiHost = new URL(requireLocalEnv("VERCEL_API_BASE_URL")).host;
    const vercelRequests = seen.filter((href) => new URL(href).host !== databaseHost);
    expect(vercelRequests.length).toBeGreaterThanOrEqual(5);
    for (const href of seen) {
      const url = new URL(href);
      expect([apiHost, databaseHost], href).toContain(url.host);
      expect(url.hostname, href).not.toContain("example.test");
    }
    const allowed = [addPath(), domainPath(host), verifyPath(host), configPath(host)];
    for (const request of await requestsFor(host)) expect(allowed, `${request.method} ${request.path}`).toContain(request.path);
  });
});

test.describe("pending domains expire after 7 days", () => {
  test("M4-15 Check DNS now on an 8-day-old pending domain releases it (Vercel DELETE, row gone) and says so; a 6-day-old one is still checked", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("ex", "studio");
    const old = UNIQUE();
    const recent = UNIQUE();
    const day = 86_400_000;
    const oldId = await addDomainRow({ pageId: site.pageId, hostname: old, status: "pending", createdAt: new Date(Date.now() - 8 * day).toISOString() });
    const recentId = await addDomainRow({ pageId: site.pageId, hostname: recent, status: "pending", createdAt: new Date(Date.now() - 6 * day).toISOString() });
    await markDnsReady(old);

    const result = await checkDomain(realDeps(), site.user.id, oldId);
    expect(result).toEqual({
      ok: false,
      error: "domain_expired",
      message: "This domain wasn’t connected within 7 days, so we released it. Add it again to try once more.",
      status: 410,
    });
    expect(await domainRowOf(oldId)).toBeNull();
    expect((await removalCalls(old)).length).toBe(1);
    expect(await verifyCalls(old)).toEqual([]);
    expect((await rawRequest(old, "/")).status).toBe(404);

    // Adding it again works (the slot and the hostname are free).
    const again = await addDomain(realDeps(), site.user.id, { hostname: old, pageId: site.pageId });
    expect(again.ok).toBe(true);

    const fresh = await checkDomain(realDeps(), site.user.id, recentId);
    expect(fresh.ok && fresh.domain!.status).toBe("pending");
    expect((await verifyCalls(recent)).length).toBe(1);
    expect(await removalCalls(recent)).toEqual([]);
  });
});

test.describe("M4-17 remove a custom domain", () => {
  test("M4-17 removing sends the remove request, deletes the row, frees the slot and the very next request to the host is a 404", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("ra", "pro");
    const host = UNIQUE();
    const added = await addDomain(realDeps(), site.user.id, { hostname: host, pageId: site.pageId });
    const id = added.ok ? added.domain!.id : "";
    await markDnsReady(host);
    await checkDomain(realDeps(), site.user.id, id);
    expect((await rawRequest(host, "/")).status).toBe(200);

    const deps = realDeps();
    expect(await removeDomain(deps, site.user.id, id)).toEqual({ ok: true });
    const removals = await removalCalls(host);
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({ hasBearer: true });
    expect(await domainRowOf(id)).toBeNull();
    expect(deps.expired).toEqual([site.pageId]);
    // Removed from this process: a production build holds the found host for up to 60 s.
    const gone = await untilHostLookupExpires(() => rawRequest(host, "/"), (r) => r.status === 404, "found");
    expect(gone.status).toBe(404);
    expect(gone.body).not.toContain(site.name);
    // The slot is free again.
    expect((await addDomain(realDeps(), site.user.id, { hostname: UNIQUE(), pageId: site.pageId })).ok).toBe(true);
  });

  test("M4-17 a stub 404 on removal (already gone) counts as success; a 5xx keeps the row and says so", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("rb", "studio");
    const gone = UNIQUE();
    const stuck = UNIQUE();
    const goneId = (await addDomain(realDeps(), site.user.id, { hostname: gone, pageId: site.pageId }) as { domain: { id: string } }).domain.id;
    const stuckId = (await addDomain(realDeps(), site.user.id, { hostname: stuck, pageId: site.pageId }) as { domain: { id: string } }).domain.id;

    await setDomainState(gone, { removeStatus: 404 });
    expect(await removeDomain(realDeps(), site.user.id, goneId)).toEqual({ ok: true });
    expect(await domainRowOf(goneId)).toBeNull();

    await setDomainState(stuck, { removeStatus: 500 });
    expect(await removeDomain(realDeps(), site.user.id, stuckId)).toMatchObject({
      ok: false,
      error: "vercel_unavailable",
      message: "We couldn’t remove that domain from our host. Try again.",
    });
    expect(await domainRowOf(stuckId)).not.toBeNull();
    await setDomainState(stuck, { removeStatus: null });
    expect(await removeDomain(realDeps(), site.user.id, stuckId)).toEqual({ ok: true });
    await forgetDomain(stuck);
  });

  test("M4-09 re-pointing a domain at another page expires both pages and the host serves the new one", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    const site = await makeSite("rc", "studio");
    const other = await publishedPage(site.user.id, `zq-rc2-${rand(5)}`, `Second ${rand(4)}`);
    const host = UNIQUE();
    const added = await addDomain(realDeps(), site.user.id, { hostname: host, pageId: site.pageId });
    const id = added.ok ? added.domain!.id : "";
    await markDnsReady(host);
    await checkDomain(realDeps(), site.user.id, id);
    expect((await rawRequest(host, "/")).body).toContain(site.name);
    const deps = realDeps();
    expect((await setDomainPage(deps, site.user.id, id, other)).ok).toBe(true);
    expect([...deps.expired].sort()).toEqual([site.pageId, other].sort());
    // Re-pointed from this process: a production build holds the found host for up to 60 s.
    const body = (
      await untilHostLookupExpires(() => rawRequest(host, "/"), (r) => /Second /.test(r.body), "found")
    ).body;
    expect(body).not.toContain(site.name);
    expect(body).toMatch(/Second /);
  });
});
