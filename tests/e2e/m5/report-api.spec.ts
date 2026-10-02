import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, insertPage, makeUser, rand } from "../fixtures/data";
import { url } from "../helpers";

/**
 * M5-05 abuse cases against the report form's endpoint (POST /report/submit) and the table behind it
 * (/rest/v1/reports with the publishable key). Every test uses its own IPv6 address in
 * x-forwarded-for (the endpoint reads the platform's client-IP header), its own pages and users, and
 * removes its reports; nothing here touches mara.
 */

test.describe.configure({ timeout: 180_000 });

const SENT = "Report sent. We’ll review it.";
const TOO_MANY = "Too many reports. Try again later.";
const NOT_FOUND = "We couldn’t find that page. Check the address.";
const ENDPOINT = url(null, "/report/submit");

const handles: string[] = [];

// report_attempts rows hold only hashes and are pruned by the database after a day: nothing to clean
// up there, and no way to tell this file's rows from another worker's.
test.afterAll(async () => {
  if (handles.length > 0) await adminClient().from("reports").delete().in("page_handle", handles);
  await cleanupUsers();
});

const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
const ipv6 = () => `2001:db8:${hex()}:${hex()}::${hex()}`;

interface Posted {
  status: number;
  body: { ok: boolean; message?: string; errors?: Record<string, string> };
  retryAfter: string | null;
}
async function post(body: unknown, ip: string | null = ipv6(), headers: Record<string, string> = {}): Promise<Posted> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Posted["body"];
  try {
    parsed = JSON.parse(text) as Posted["body"];
  } catch {
    parsed = { ok: false, message: text };
  }
  return { status: res.status, body: parsed, retryAfter: res.headers.get("retry-after") };
}

interface Row {
  id: string;
  page_id: string | null;
  page_handle: string | null;
  reason: string;
  details: string | null;
  reporter_email: string | null;
  reporter_hash: string;
  status: string;
}
const reportsFor = async (pageId: string): Promise<Row[]> => {
  const { data, error } = await adminClient().from("reports").select("*").eq("page_id", pageId);
  if (error) throw new Error(error.message);
  return data as Row[];
};

async function publishedPage(label: string, opts: { published?: boolean; plan?: "free" | "pro" } = {}) {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  handles.push(handle);
  const published = opts.published ?? true;
  const pageId = await insertPage(user.id, handle, published ? { published: { version: 1 }, published_at: new Date().toISOString() } : {});
  return { ...user, handle, pageId };
}

test.describe("M5-05 the table and its functions are closed to the publishable key", () => {
  test("M5-05 direct API: POST /rest/v1/reports, anonymous and with a user JWT, is rejected and writes no row; select, update, delete and the SQL functions are closed too", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-direct");
    const token = await accessTokenFor(page.email);
    const row = { page_id: page.pageId, reason: "spam", reporter_hash: "a".repeat(64) };
    const call = (bearer: string | null, path: string, init: RequestInit = {}) =>
      fetch(`${supabaseUrl()}/rest/v1${path}`, {
        ...init,
        headers: {
          apikey: publishableKey(),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          "content-type": "application/json",
          Prefer: "return=representation",
        },
      });

    for (const [who, bearer] of [["anon", null], ["authenticated", token]] as const) {
      const insert = await call(bearer, "/reports", { method: "POST", body: JSON.stringify(row) });
      expect([401, 403], `${who} insert: ${await insert.clone().text()}`).toContain(insert.status);
      const select = await call(bearer, "/reports?select=*");
      expect([401, 403], `${who} select`).toContain(select.status);
      const update = await call(bearer, "/reports?status=eq.open", { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) });
      expect([401, 403], `${who} update`).toContain(update.status);
      const del = await call(bearer, "/reports?status=eq.open", { method: "DELETE" });
      expect([401, 403], `${who} delete`).toContain(del.status);
      const attempts = await call(bearer, "/report_attempts?select=*");
      expect([401, 403], `${who} attempts`).toContain(attempts.status);
      const file = await call(bearer, "/rpc/submit_report", {
        method: "POST",
        body: JSON.stringify({ p_page_id: page.pageId, p_page_handle: page.handle, p_reason: "spam", p_details: null, p_email: null, p_hashes: ["b".repeat(64)] }),
      });
      expect([401, 403], `${who} submit_report`).toContain(file.status);
      const limit = await call(bearer, "/rpc/report_rate_limit_hit", {
        method: "POST",
        body: JSON.stringify({ p_keys: ["c".repeat(64)], p_limit: 1, p_window_seconds: 60 }),
      });
      expect([401, 403], `${who} report_rate_limit_hit`).toContain(limit.status);
    }
    expect(await reportsFor(page.pageId)).toEqual([]);
    const attempts = await adminClient().from("report_attempts").select("id").in("bucket", ["b".repeat(64), "c".repeat(64)]);
    expect(attempts.data).toEqual([]);
  });
});

test.describe("M5-05 the endpoint validates on the server", () => {
  test("M5-05 a direct POST with 5000 characters of details, an unknown reason, an invalid email or a bad page id is 4xx and writes no row", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-valid");
    const base = { page: page.pageId, reason: "phishing" };

    const long = await post({ ...base, details: "x".repeat(5000) });
    expect(long.status).toBe(400);
    expect(long.body.errors?.details).toMatch(/at most 1000 characters/);
    const reason = await post({ ...base, reason: "not-a-reason" });
    expect(reason.status).toBe(400);
    expect(reason.body.errors?.reason).toBe("Choose a reason.");
    const email = await post({ ...base, email: "not-an-email" });
    expect(email.status).toBe(400);
    expect(email.body.errors?.email).toMatch(/valid email address/);
    const other = await post({ ...base, reason: "other" });
    expect(other.status).toBe(400);
    expect(other.body.errors?.details).toMatch(/required for Something else/);
    const badId = await post({ page: "not-a-uuid", reason: "spam" });
    expect(badId.status).toBe(400);
    expect(badId.body.errors?.page).toBeDefined();
    const nothing = await post({ reason: "spam" });
    expect(nothing.status).toBe(400);
    expect(nothing.body.errors?.address).toBeDefined();
    expect((await post("{broken")).status).toBe(400);
    expect((await post([1, 2, 3])).status).toBe(400);
    expect((await post("page=1", ipv6(), { "content-type": "text/plain" })).status).toBe(400);

    expect(await reportsFor(page.pageId)).toEqual([]);
  });

  test("M5-05 a body over 16 KB is 413 and nothing is read or written; a cross-site browser post is 403", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-size");
    const huge = await post({ page: page.pageId, reason: "spam", details: "x".repeat(40_000) });
    expect(huge.status).toBe(413);
    const evil = await post({ page: page.pageId, reason: "spam" }, ipv6(), { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const sameSite = await post({ page: page.pageId, reason: "spam" }, ipv6(), { origin: "http://localhost:3000" });
    expect(sameSite.status).toBe(200);
    expect(await reportsFor(page.pageId)).toHaveLength(1);
  });

  test("M5-05 a page that does not exist, is unpublished or cannot be addressed is 404 with the address message, and nothing is filed", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const draftOnly = await publishedPage("rp-draft", { published: false });
    const unknownId = await post({ page: "11111111-1111-4111-8111-111111111111", reason: "spam" });
    expect(unknownId.status).toBe(404);
    expect(unknownId.body.errors?.page).toBe(NOT_FOUND);
    const unpublished = await post({ page: draftOnly.pageId, reason: "spam" });
    expect(unpublished.status).toBe(404);
    const byUnknownHandle = await post({ address: `nobody-${rand(8)}.hydlnk.com`, reason: "spam" });
    expect(byUnknownHandle.status).toBe(404);
    expect(byUnknownHandle.body.errors?.address).toBe(NOT_FOUND);
    for (const address of ["hydlnk.com", "app.hydlnk.com", "not a host", "javascript:alert(1)", "https://"]) {
      const bad = await post({ address, reason: "spam" });
      expect(bad.status, address).toBe(404);
      expect(bad.body.errors?.address, address).toBe(NOT_FOUND);
    }
    expect(await reportsFor(draftOnly.pageId)).toEqual([]);
  });
});

test.describe("M5-05 filing, repeats and the honeypot", () => {
  test("M5-05 a report inserts one open row with a hashed IP; the same IP reporting the same page again inserts nothing and reads the same; another IP adds a row", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-file");
    const ip = ipv6();
    const first = await post({ page: page.pageId, reason: "phishing", details: "  Fake login page.  ", email: "me@example.com" }, ip);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, message: SENT });

    const rows = await reportsFor(page.pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      page_id: page.pageId,
      page_handle: page.handle,
      reason: "phishing",
      details: "Fake login page.",
      reporter_email: "me@example.com",
      status: "open",
    });
    expect(rows[0]!.reporter_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain(ip);

    const again = await post({ page: page.pageId, reason: "spam" }, ip);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true, message: SENT });
    expect(await reportsFor(page.pageId)).toHaveLength(1);

    const other = await post({ page: page.pageId, reason: "spam" }, ipv6());
    expect(other.status).toBe(200);
    const all = await reportsFor(page.pageId);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((r) => r.reporter_hash)).size).toBe(2);
  });

  test("M5-05 the same visitor reporting two pages leaves the same hash on both rows (so a visitor can be recognised for a day, and an IP never)", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const a = await publishedPage("rp-h1");
    const b = await publishedPage("rp-h2");
    const ip = ipv6();
    expect((await post({ page: a.pageId, reason: "spam" }, ip)).status).toBe(200);
    expect((await post({ page: b.pageId, reason: "spam" }, ip)).status).toBe(200);
    const [ra] = await reportsFor(a.pageId);
    const [rb] = await reportsFor(b.pageId);
    expect(ra!.reporter_hash).toBe(rb!.reporter_hash);
  });

  test("M5-05 a filled honeypot field reads as success and inserts nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-bot");
    const ip = ipv6();
    const bot = await post({ page: page.pageId, reason: "phishing", company_url: "http://spam.example" }, ip);
    expect(bot.status).toBe(200);
    expect(bot.body).toEqual({ ok: true, message: SENT });
    expect(await reportsFor(page.pageId)).toEqual([]);
    // The bot's submission did not count against the visitor's hourly limit either: five real ones follow.
    for (let i = 0; i < 5; i++) {
      const p = await publishedPage(`rp-bot${i}`);
      expect((await post({ page: p.pageId, reason: "spam" }, ip)).status).toBe(200);
    }
  });

  test("M5-05 a report finds its page by handle address and by a verified custom domain, and not by a pending one", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-addr", { plan: "pro" });
    const byHandle = await post({ address: `https://${page.handle.toUpperCase()}.hydlnk.com/x`, reason: "spam" });
    expect(byHandle.status).toBe(200);
    const bare = await post({ address: page.handle, reason: "spam" });
    expect(bare.status).toBe(200);
    const local = await post({ address: `${page.handle}.localhost:3000`, reason: "spam" });
    expect(local.status).toBe(200);
    expect(await reportsFor(page.pageId)).toHaveLength(3);

    const verified = `zq-${rand(8)}.example.com`;
    const pending = `zq-${rand(8)}.example.org`;
    const admin = adminClient();
    // Pro allows one domain: the verified one first, then (after it is gone) a pending one.
    const addVerified = await admin
      .from("domains")
      .insert({ page_id: page.pageId, hostname: verified, status: "verified", verified_at: new Date().toISOString() });
    expect(addVerified.error).toBeNull();
    const before = (await reportsFor(page.pageId)).length;
    const viaDomain = await post({ address: `https://${verified}/`, reason: "malware" });
    expect(viaDomain.status).toBe(200);
    expect((await reportsFor(page.pageId)).length).toBe(before + 1);
    await admin.from("domains").delete().eq("page_id", page.pageId);
    const addPending = await admin.from("domains").insert({ page_id: page.pageId, hostname: pending, status: "pending" });
    expect(addPending.error).toBeNull();
    const viaPending = await post({ address: pending, reason: "malware" });
    expect(viaPending.status).toBe(404);
    expect((await reportsFor(page.pageId)).length).toBe(before + 1);
    await admin.from("domains").delete().eq("page_id", page.pageId);
  });
});

test.describe("M5-05 floods", () => {
  test("M5-05 the 6th report from one IP within an hour is 429 Too many reports with Retry-After and inserts nothing; a different IP is unaffected (same page)", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-rate");
    const ip = ipv6();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await post({ page: page.pageId, reason: "spam" }, ip)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    const sixth = await post({ page: page.pageId, reason: "spam" }, ip);
    expect(sixth.status).toBe(429);
    expect(sixth.body.message).toBe(TOO_MANY);
    expect(Number(sixth.retryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number(sixth.retryAfter)).toBeLessThanOrEqual(3600);
    expect(await reportsFor(page.pageId)).toHaveLength(1);

    const elsewhere = await post({ page: page.pageId, reason: "spam" }, ipv6());
    expect(elsewhere.status).toBe(200);
    expect(await reportsFor(page.pageId)).toHaveLength(2);
  });

  test("M5-05 six different pages from one IP: five rows, then 429 and no sixth row", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const pages = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => publishedPage(`rp-six${n}`)));
    const ip = ipv6();
    const statuses: number[] = [];
    for (const page of pages) statuses.push((await post({ page: page.pageId, reason: "malware" }, ip)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(await reportsFor(pages[5]!.pageId)).toEqual([]);
    for (const page of pages.slice(0, 5)) expect(await reportsFor(page.pageId)).toHaveLength(1);
  });

  test("M5-05 a request with no client-IP header is counted in one shared bucket instead of skipping the limit", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    // Some earlier request in this hour may already have used the shared bucket, so only the shape is asserted:
    // sending no header never makes a request free (a flood of header-less posts ends in a 429).
    const page = await publishedPage("rp-unknown");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post({ page: page.pageId, reason: "spam" }, null)).status);
    expect(statuses).toContain(429);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
  });

  test("M5-05 a flood of reports against one page from many IPs is capped: after 25 new reports in an hour more read as sent but insert nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-flood");
    const results: number[] = [];
    for (let i = 0; i < 28; i++) results.push((await post({ page: page.pageId, reason: "spam", details: `flood ${i}` }, ipv6())).status);
    expect(results.every((s) => s === 200)).toBe(true);
    expect(await reportsFor(page.pageId)).toHaveLength(25);
  });

  test("M5-05 the limit window rolls over: attempts older than an hour stop counting", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const page = await publishedPage("rp-roll");
    const ip = ipv6();
    for (let i = 0; i < 5; i++) await post({ page: page.pageId, reason: "spam" }, ip);
    expect((await post({ page: page.pageId, reason: "spam" }, ip)).status).toBe(429);
    // Age this reporter's attempts past the window: the secret-key client may, nothing else can. The
    // reporter's bucket is the hash their first report was filed under.
    const [filed] = await reportsFor(page.pageId);
    expect(filed!.reporter_hash).toMatch(/^[0-9a-f]{64}$/);
    const admin = adminClient();
    const aged = await admin
      .from("report_attempts")
      .update({ created_at: new Date(Date.now() - 61 * 60 * 1000).toISOString() })
      .eq("bucket", filed!.reporter_hash)
      .select("id");
    expect(aged.data).toHaveLength(5);
    expect((await post({ page: page.pageId, reason: "spam" }, ip)).status).toBe(200);
  });
});
