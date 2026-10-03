import { expect, test } from "@playwright/test";
import { cleanupUsers, accessTokenFor, desktopOnly, signedInUser } from "../fixtures/data";
import { adminClient } from "../fixtures/auth";
import { appRaw, authCookies, cookieHeader, rawRequest, restAs } from "../fixtures/http";
import { getMessage, messagesTo, waitForMessages } from "../fixtures/mailpit";
import { requireLocalEnv } from "../fixtures/stripe-stub";
import { markDnsReady, requestsFor, setDomainState, verifyCalls } from "../fixtures/vercel-stub";
import {
  addDomainRow,
  domainRowOf,
  hostnameFor,
  makeSite,
  resetCooldown,
} from "./domains-core-helpers";

/**
 * M4-15 / M4-12 / M4-17 / M5-23, the HTTP and database edges of custom domains (the logic itself
 * runs in tests/unit/domains-*.test.ts and tests/e2e/m4/domains-core-flow.spec.ts): the five-minute
 * sweep route, the polling route, and what a user can and cannot do to `domains` with the
 * publishable key and curl. Data flows, so one project is enough.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const SECRET = () => requireLocalEnv("CRON_SECRET");
const SWEEP = "/api/cron/verify-domains";
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const sweep = (headers: Record<string, string>, path = SWEEP) =>
  appRaw(path, { method: "POST", headers });

test.describe("M4-15 POST /api/cron/verify-domains", () => {
  test("M4-15 a missing or wrong secret, or one in the query string, is a 401 and changes nothing; GET is a 405", async ({}, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const site = await makeSite("sw0");
    const host = hostnameFor("sw0");
    const id = await addDomainRow({ pageId: site.pageId, hostname: host, status: "pending" });
    await markDnsReady(host);

    const attempts: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong-secret" },
      { authorization: SECRET() },
      { authorization: `Basic ${SECRET()}` },
    ];
    for (const headers of attempts) {
      const res = await sweep(headers);
      expect(res.status, JSON.stringify(Object.keys(headers))).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: "unauthorized" });
    }
    const query = await sweep({}, `${SWEEP}?secret=${encodeURIComponent(SECRET())}`);
    expect(query.status).toBe(401);
    expect((await appRaw(SWEEP)).status).toBe(405);
    expect((await appRaw(SWEEP, { method: "PUT" })).status).toBe(405);

    // Nothing moved: the domain is still pending and Vercel was never asked.
    expect((await domainRowOf(id))!.status).toBe("pending");
    expect(await requestsFor(host)).toEqual([]);

    // The secret never comes back in a response.
    for (const res of [await sweep({}), await sweep({ authorization: "Bearer nope" })]) {
      expect(res.body).not.toContain(SECRET());
    }
  });

  test("M4-15 it is a 404 on marketing, tenant and custom hosts", async ({}, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const site = await makeSite("sw1");
    const host = hostnameFor("sw1");
    await addDomainRow({ pageId: site.pageId, hostname: host, status: "verified" });
    const headers = { authorization: `Bearer ${SECRET()}` };
    for (const h of ["localhost:3000", "mara.localhost:3000", `${site.handle}.localhost:3000`, host, hostnameFor("nobody")]) {
      const res = await rawRequest(h, SWEEP, { method: "POST", headers });
      expect(res.status, h).toBe(404);
      expect(res.body, h).not.toContain('"checked"');
    }
  });

  test("M4-15 / M5-23 with two pending domains and the stub reporting one verified, one call flips exactly that row, skips the 8-day-old one, and emails once", async ({}, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const site = await makeSite("sw2");
    const ready = hostnameFor("ready");
    const waiting = hostnameFor("wait");
    const old = hostnameFor("old");
    const readyId = await addDomainRow({ pageId: site.pageId, hostname: ready, status: "pending" });
    const waitingId = await addDomainRow({ pageId: site.pageId, hostname: waiting, status: "pending" });
    const oldId = await addDomainRow({ pageId: site.pageId, hostname: old, status: "pending", createdAt: days(8) });
    await markDnsReady(ready);
    await setDomainState(waiting, { verified: true, misconfigured: true });
    await markDnsReady(old); // verified at Vercel, but too old for the sweep

    const res = await sweep({ authorization: `Bearer ${SECRET()}` });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { checked: number; verified: number };
    expect(Object.keys(body).sort()).toEqual(["checked", "verified"]);
    expect(body.checked).toBeGreaterThanOrEqual(2);
    expect(body.verified).toBeGreaterThanOrEqual(1);
    expect(String(res.headers["cache-control"])).toMatch(/no-store/);

    const readyRow = (await domainRowOf(readyId))!;
    expect(readyRow.status).toBe("verified");
    expect(readyRow.verified_at).toBeTruthy();
    expect(readyRow.last_checked_at).toBeTruthy();
    expect((await domainRowOf(waitingId))!.status).toBe("pending");
    expect((await domainRowOf(waitingId))!.last_checked_at).toBeTruthy();
    const oldRow = (await domainRowOf(oldId))!;
    expect(oldRow.status).toBe("pending");
    expect(oldRow.last_checked_at).toBeNull();
    expect(await verifyCalls(old)).toEqual([]);
    expect((await verifyCalls(ready)).length).toBe(1);

    // The custom host serves at once; the email arrived once, from the sweep.
    expect((await rawRequest(ready, "/")).status).toBe(200);
    const mail = await waitForMessages(site.user.email, 1);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.Subject).toBe(`${ready} is live`);
    const full = await getMessage(mail[0]!.ID);
    expect(full.Text).toContain(`Your page is now served at https://${ready}.`);
    expect(full.Text).not.toContain("!");
    expect((full.HTML.match(/<a\s/g) ?? []).length).toBe(1);
    expect(full.HTML).toContain(`Open ${ready}`);
    expect((await domainRowOf(readyId))!.live_email_sent_at).toBeTruthy();

    // A second sweep: the verified domain is not asked again and nothing more is sent.
    await sweep({ authorization: `Bearer ${SECRET()}` });
    expect((await verifyCalls(ready)).length).toBe(1);
    await new Promise((r) => setTimeout(r, 600));
    expect(await messagesTo(site.user.email)).toHaveLength(1);

    // The 8-day-old one can still be verified by Check DNS now (the shared routine, cooldown aside).
    expect((await domainRowOf(oldId))!.status).toBe("pending");
  });

  test("M4-15 the sweep honours the cooldown: a domain checked moments ago is not asked again", async ({}, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const site = await makeSite("sw3");
    const host = hostnameFor("cool");
    const id = await addDomainRow({ pageId: site.pageId, hostname: host, status: "pending" });
    await sweep({ authorization: `Bearer ${SECRET()}` });
    await sweep({ authorization: `Bearer ${SECRET()}` });
    await sweep({ authorization: `Bearer ${SECRET()}` });
    expect((await verifyCalls(host)).length).toBe(1);
    await resetCooldown(id);
    await sweep({ authorization: `Bearer ${SECRET()}` });
    expect((await verifyCalls(host)).length).toBe(2);
  });
});

test.describe("M4-15 GET /api/domains/[id] (what the screen polls)", () => {
  test("M4-15 401 signed out, 404 for another account's domain with no Vercel call, 200 for the owner; polling notices the flip", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const owner = await signedInUser(context, { label: "po", plan: "studio" });
    const other = await makeSite("po2");
    const mine = hostnameFor("mine");
    const theirs = hostnameFor("theirs");
    const mineId = await addDomainRow({ pageId: owner.pageId, hostname: mine, status: "pending" });
    const theirsId = await addDomainRow({ pageId: other.pageId, hostname: theirs, status: "pending" });
    const cookie = cookieHeader(await authCookies(context));

    const anon = await appRaw(`/api/domains/${mineId}`);
    expect(anon.status).toBe(401);
    expect(await requestsFor(mine)).toEqual([]);

    const notMine = await appRaw(`/api/domains/${theirsId}`, { cookie });
    expect(notMine.status).toBe(404);
    expect((await appRaw(`/api/domains/not-a-uuid`, { cookie })).status).toBe(404);
    expect(await requestsFor(theirs)).toEqual([]);

    const first = await appRaw(`/api/domains/${mineId}`, { cookie });
    expect(first.status).toBe(200);
    expect(String(first.headers["cache-control"])).toMatch(/no-store/);
    const view = JSON.parse(first.body);
    expect(view).toMatchObject({
      id: mineId,
      hostname: mine,
      pageId: owner.pageId,
      status: "pending",
      verifiedAt: null,
      records: [{ type: "CNAME", name: "zq-mine-" + mine.split("-")[2]!.split(".")[0], value: "abc123.vercel-dns-017.com" }],
      recordsUnavailable: false,
      apex: { name: "example.test", ipv4: "203.0.113.10" },
    });
    expect(view.lastCheckedAt).toBeTruthy();

    // Polling again at once is held by the cooldown: no second verify request.
    await appRaw(`/api/domains/${mineId}`, { cookie });
    expect((await verifyCalls(mine)).length).toBe(1);

    // The stub turns verified; the next poll after the cooldown flips it and says so.
    await markDnsReady(mine);
    await resetCooldown(mineId);
    const flipped = JSON.parse((await appRaw(`/api/domains/${mineId}`, { cookie })).body);
    expect(flipped).toMatchObject({ status: "verified", records: [], misconfigured: false });
    expect(flipped.verifiedAt).toBeTruthy();
    expect((await domainRowOf(mineId))!.status).toBe("verified");
    // Another poll: verified is returned as is, no new Vercel request.
    const before = (await requestsFor(mine)).length;
    await appRaw(`/api/domains/${mineId}`, { cookie });
    expect((await requestsFor(mine)).length).toBe(before);

    // The email went to the owner's address, once.
    expect(await waitForMessages(owner.email, 1)).toHaveLength(1);
  });

  test("M4-13 the config request failing: 'records unavailable', no values; the stub values are shown fresh on every read", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const owner = await signedInUser(context, { label: "pr", plan: "studio" });
    const host = hostnameFor("rec");
    const id = await addDomainRow({ pageId: owner.pageId, hostname: host, status: "pending" });
    const cookie = cookieHeader(await authCookies(context));
    const read = async () => JSON.parse((await appRaw(`/api/domains/${id}`, { cookie })).body);

    await setDomainState(host, { configStatus: 500 });
    expect(await read()).toMatchObject({ records: [], recordsUnavailable: true, apex: null });
    await setDomainState(host, { configStatus: null });
    await resetCooldown(id);
    await setDomainState(host, {
      recommendedCNAME: [{ rank: 1, value: "xyz789.vercel-dns-042.com." }],
      verification: [{ type: "TXT", domain: `_vercel.${host.split(".").slice(-2).join(".")}`, value: "vc-domain-verify=abc,def", reason: "pending" }],
    });
    const ok = await read();
    expect(ok.recordsUnavailable).toBe(false);
    expect(ok.records).toEqual([
      { type: "CNAME", name: host.split(".")[0], value: "xyz789.vercel-dns-042.com" },
      { type: "TXT", name: "_vercel", value: "vc-domain-verify=abc,def" },
    ]);
  });
});

test.describe("M4-11 / M4-12 / M4-15 / M4-17 / M5-23 what a user can do to `domains` with the publishable key and curl", () => {
  test("add, change status, verified_at, last_checked_at, live_email_sent_at and delete are all refused; select shows only the caller's own rows", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const owner = await signedInUser(context, { label: "rl", plan: "pro" });
    const stranger = await makeSite("rl2");
    const mineHost = hostnameFor("ownd");
    const theirsHost = hostnameFor("othr");
    const mineId = await addDomainRow({ pageId: owner.pageId, hostname: mineHost, status: "pending" });
    await addDomainRow({ pageId: stranger.pageId, hostname: theirsHost, status: "verified" });
    const token = await accessTokenFor(owner.email);
    const admin = adminClient();

    // Add is server-only: a past-the-limit insert, a verified one and a plain one.
    for (const body of [
      { page_id: owner.pageId, hostname: hostnameFor("x1"), status: "verified", verified_at: new Date().toISOString() },
      { page_id: owner.pageId, hostname: hostnameFor("x2") },
      { page_id: owner.pageId, hostname: hostnameFor("x3"), live_email_sent_at: new Date().toISOString() },
    ]) {
      const res = await restAs(token, "/domains", { method: "POST", body });
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      const count = await admin.from("domains").select("id", { count: "exact", head: true }).eq("hostname", body.hostname);
      expect(count.count).toBe(0);
    }

    // Nothing about an existing row can be changed.
    for (const patch of [
      { status: "verified" },
      { verified_at: new Date().toISOString() },
      { last_checked_at: new Date().toISOString() },
      { live_email_sent_at: null },
      { live_email_sent_at: new Date().toISOString() },
      { hostname: hostnameFor("evil") },
      { page_id: stranger.pageId },
    ]) {
      const res = await restAs(token, `/domains?id=eq.${mineId}`, { method: "PATCH", body: patch });
      expect(res.status, JSON.stringify(patch)).toBeGreaterThanOrEqual(400);
    }
    const unchanged = (await domainRowOf(mineId))!;
    expect(unchanged).toMatchObject({ status: "pending", verified_at: null, last_checked_at: null, live_email_sent_at: null, hostname: mineHost, page_id: owner.pageId });

    // Delete is refused and the row remains.
    const del = await restAs(token, `/domains?id=eq.${mineId}`, { method: "DELETE" });
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect(await domainRowOf(mineId)).not.toBeNull();

    // Select: only my own rows, new columns included.
    const list = await restAs(token, "/domains?select=id,hostname,status,last_checked_at,live_email_sent_at");
    expect(list.status).toBe(200);
    expect((list.body as { hostname: string }[]).map((r) => r.hostname)).toEqual([mineHost]);

    // Signed out (the publishable key alone): nothing.
    const anon = await fetch(`${requireLocalEnv("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/domains?select=id`, {
      headers: { apikey: requireLocalEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") },
    });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });
});
