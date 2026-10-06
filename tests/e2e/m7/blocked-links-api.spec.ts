import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import {
  accessTokenFor,
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  rand,
} from "../fixtures/data";
import { ingestPage } from "../m4/analytics-ingest-helpers";
import { expectDenied, rest } from "../m4/analytics-db-helpers";
import { draftOf } from "../m2/blocks-helpers";
import {
  json,
  postApp,
  sessionCookie,
  signInAsAdmin,
  signInAsUser,
  tenantRaw,
} from "../m5/admin-helpers";
import {
  auditRows,
  blockPath,
  domainRow,
  linkBlock,
  newDomain,
  removePath,
  track,
} from "./blocked-links-helpers";

/**
 * M7-12: the two admin actions behind /admin/blocked-links, through the front door. Raw HTTP on the
 * desktop project (nothing here involves a viewport), each test with its own random domain, user and
 * page. The unit tests (tests/unit/m7-policy-blocked-domain-*.test.ts) cover the same rules against
 * an in-memory database; this proves them against the real routes, session and Postgres.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(async () => {
  await track.cleanup();
  await cleanupUsers();
});

const countDomains = async (): Promise<number> => {
  const { count, error } = await adminClient()
    .from("blocked_domains")
    .select("domain", { count: "exact", head: true });
  if (error) throw new Error(`count failed: ${error.message}`);
  return count ?? 0;
};

test.describe("M7-12 who can call the two actions", () => {
  test("M7-12 nobody signed in gets 401 and a signed-in non-admin 403, on both actions, and nothing changes", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    const domain = newDomain();
    const body = JSON.stringify({ domain, reason: "e2e" });

    const anonymous = await postApp(blockPath(), { body });
    expect(anonymous.status).toBe(401);
    expect(json(anonymous).error).toBe("unauthenticated");
    const anonymousRemove = await postApp(removePath(domain));
    expect(anonymousRemove.status).toBe(401);

    await signInAsUser(context, "blna");
    const cookie = await sessionCookie(context);
    const forbidden = await postApp(blockPath(), { body, cookie });
    expect(forbidden.status).toBe(403);
    expect(json(forbidden).error).toBe("forbidden");
    expect((await postApp(removePath(domain), { cookie })).status).toBe(403);

    expect(await domainRow(domain)).toBeNull();
    expect(await auditRows(domain)).toEqual([]);
  });

  test("M7-12 a cross-origin Origin is 403 forbidden_origin, a body that is not JSON is 415 and one that is not an object is 400", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    await signInAsAdmin(context, "blorg");
    const cookie = await sessionCookie(context);
    const domain = newDomain();
    const body = JSON.stringify({ domain, reason: "e2e" });

    for (const path of [blockPath(), removePath(domain)]) {
      const cross = await postApp(path, { cookie, body, origin: "http://evil.example" });
      expect(cross.status, path).toBe(403);
      expect(json(cross).error).toBe("forbidden_origin");
      expect((await postApp(path, { cookie, body, contentType: "text/plain" })).status, path).toBe(
        415,
      );
      expect((await postApp(path, { cookie, body: "not json" })).status, path).toBe(400);
      expect((await postApp(path, { cookie, body: "[]" })).status, path).toBe(400);
      expect((await postApp(path, { cookie, body: "null" })).status, path).toBe(400);
    }
    expect(await domainRow(domain)).toBeNull();
  });
});

test.describe("M7-12 block_domain", () => {
  test("M7-12 blocks a domain, answers with the live pages that already link to it, never unpublishes them and audits it once", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    const domain = newDomain();
    const live = await ingestPage("bllive", {
      blocks: [
        linkBlock("lnkblk000001", `https://shop.${domain}/a`),
        linkBlock("lnkblk000002", `https://${domain}/b`),
      ],
      draft: draftOf("x", [
        linkBlock("lnkblk000001", `https://shop.${domain}/a`),
        linkBlock("lnkblk000002", `https://${domain}/b`),
      ]),
    });
    expect((await tenantRaw(live.handle)).status).toBe(200);
    const before = await adminClient()
      .from("pages")
      .select("published, published_at")
      .eq("id", live.pageId)
      .single();

    const admin = await signInAsAdmin(context, "blok");
    const cookie = await sessionCookie(context);
    const added = await postApp(blockPath(), {
      cookie,
      body: JSON.stringify({
        domain: `https://www.${domain.toUpperCase()}/pasted`,
        reason: "  e2e spam  ",
      }),
    });
    expect(added.status).toBe(200);
    expect(json(added)).toMatchObject({
      ok: true,
      changed: true,
      domain,
      pages: 1,
      drafts: 1,
      list: [{ handle: live.handle, hosts: [domain, `shop.${domain}`], links: 2 }],
    });
    expect(await domainRow(domain)).toMatchObject({
      domain,
      reason: "e2e spam",
      added_by: admin.userId,
    });

    // Nothing was unpublished: the page still serves, and its published copy is untouched.
    expect((await tenantRaw(live.handle)).status).toBe(200);
    const after = await adminClient()
      .from("pages")
      .select("published, published_at")
      .eq("id", live.pageId)
      .single();
    expect(after.data).toEqual(before.data);

    // One audit row, written for this admin, with the counts.
    expect(await auditRows(domain)).toEqual([
      {
        admin_id: admin.userId,
        action: "block_domain",
        account_id: null,
        report_id: null,
        detail: { domain, reason: "e2e spam", live_pages: 1, draft_pages: 1 },
      },
    ]);

    // Already listed: 409 with the sentence, and nothing changes.
    const again = await postApp(blockPath(), {
      cookie,
      body: JSON.stringify({ domain, reason: "other" }),
    });
    expect(again.status).toBe(409);
    expect(json(again)).toMatchObject({
      error: "already_blocked",
      message: `${domain} is already blocked.`,
    });
    expect(await auditRows(domain)).toHaveLength(1);
    expect(await domainRow(domain)).toMatchObject({ reason: "e2e spam" });

    // A starter-list entry is "already blocked" as well, and gets no audit row of its own.
    const starter = await postApp(blockPath(), {
      cookie,
      body: JSON.stringify({ domain: "grabify.link", reason: "again" }),
    });
    expect(starter.status).toBe(409);
    expect(await auditRows("grabify.link")).toEqual([]);

    // A domain nothing links to: no live pages, nothing unpublished, and still audited.
    const quiet = newDomain();
    const none = await postApp(blockPath(), {
      cookie,
      body: JSON.stringify({ domain: quiet, reason: "e2e" }),
    });
    expect(json(none)).toMatchObject({ ok: true, changed: true, pages: 0, drafts: 0, list: [] });
    expect(await auditRows(quiet)).toHaveLength(1);
  });

  test("M7-12 refusals are 400 with their sentence, write nothing and never reach the database as text", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    await signInAsAdmin(context, "blbad");
    const cookie = await sessionCookie(context);
    const before = await countDomains();
    const cases: [unknown, string][] = [
      [{ domain: "", reason: "x" }, "Enter a domain, such as example.com."],
      [{ reason: "x" }, "Enter a domain, such as example.com."],
      [{ domain: "https://", reason: "x" }, "Enter a domain, such as example.com."],
      [{ domain: "javascript:alert(1)", reason: "x" }, "Enter a domain, such as example.com."],
      [{ domain: "has space.com", reason: "x" }, "Enter a domain, such as example.com."],
      [
        { domain: "example.com'; drop table pages; --", reason: "x" },
        "Enter a domain, such as example.com.",
      ],
      [{ domain: "com", reason: "x" }, "Use the full domain, such as example.com."],
      [{ domain: "localhost", reason: "x" }, "Use the full domain, such as example.com."],
      [{ domain: "1.2.3.4", reason: "x" }, "IP addresses are blocked already."],
      [{ domain: `${"a".repeat(300)}.com`, reason: "x" }, "That domain is too long."],
      [{ domain: "example.com", reason: "" }, "Add a reason so others know why."],
      [{ domain: "example.com", reason: "   " }, "Add a reason so others know why."],
      [
        { domain: "example.com", reason: "x".repeat(121) },
        "Use 120 characters or fewer for the reason.",
      ],
      [{ domain: "x".repeat(5000), reason: "x" }, "That request isn’t valid."],
      [{ domain: "example.com", reason: "x".repeat(5000) }, "That request isn’t valid."],
      [{ domain: 5, reason: "x" }, "That request isn’t valid."],
    ];
    for (const [input, message] of cases) {
      const response = await postApp(blockPath(), { cookie, body: JSON.stringify(input) });
      const label = JSON.stringify(input).slice(0, 70);
      expect(response.status, label).toBe(400);
      expect(json(response), label).toMatchObject({ error: "invalid_input", message });
    }
    expect(await countDomains()).toBe(before);

    // A removal names its domain in the path only, and only a stored shape is accepted.
    for (const bad of [
      "a'; drop table x",
      "https%3A%2F%2Fexample.com",
      "x".repeat(300),
      "a b",
      "-bad.com",
    ]) {
      const response = await postApp(removePath(bad), { cookie });
      expect(response.status, bad).toBe(400);
      expect(json(response).message).toBe("That request isn’t valid.");
    }
    expect(await countDomains()).toBe(before);
  });

  test("M7-12 the reason is plain text: markup is stored as the characters it is", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    await signInAsAdmin(context, "blxss");
    const cookie = await sessionCookie(context);
    const domain = newDomain();
    const reason = "<script>alert(1)</script>";
    const response = await postApp(blockPath(), {
      cookie,
      body: JSON.stringify({ domain, reason }),
    });
    expect(response.status).toBe(200);
    expect(await domainRow(domain)).toMatchObject({ reason });
    // And a control or bidi character is refused.
    const bidi = await postApp(blockPath(), {
      cookie,
      body: JSON.stringify({ domain: newDomain(), reason: `ok${String.fromCodePoint(0x202e)}ok` }),
    });
    expect(bidi.status).toBe(400);
    expect(json(bidi).message).toBe("Use plain text for the reason.");
  });
});

test.describe("M7-12 unblock_domain", () => {
  test("M7-12 removes the entry once, writes one audit row, and a second call or a never-listed domain is changed: false", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    const admin = await signInAsAdmin(context, "blun");
    const cookie = await sessionCookie(context);
    const domain = newDomain();
    await postApp(blockPath(), { cookie, body: JSON.stringify({ domain, reason: "e2e reason" }) });

    const removed = await postApp(removePath(domain), { cookie });
    expect(removed.status).toBe(200);
    expect(json(removed)).toMatchObject({ ok: true, changed: true });
    expect(await domainRow(domain)).toBeNull();
    const rows = await auditRows(domain);
    expect(rows.map((row) => row.action)).toEqual(["block_domain", "unblock_domain"]);
    expect(rows[1]).toEqual({
      admin_id: admin.userId,
      action: "unblock_domain",
      account_id: null,
      report_id: null,
      detail: { domain, reason: "e2e reason" },
    });

    const second = await postApp(removePath(domain), { cookie });
    expect(second.status).toBe(200);
    expect(json(second)).toMatchObject({ ok: true, changed: false });
    expect(await auditRows(domain)).toHaveLength(2);

    const never = await postApp(removePath(newDomain()), { cookie });
    expect(never.status).toBe(200);
    expect(json(never)).toMatchObject({ ok: true, changed: false });
  });
});

test.describe("M7-12 it takes effect at once, with no cache", () => {
  test("M7-12 after a domain is added a draft that links to it is refused (HL005); after it is removed the same save goes through", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    await signInAsAdmin(context, "blfx");
    const cookie = await sessionCookie(context);
    const domain = newDomain();

    const user = await makeUser("blfxu");
    const handle = `zq-blfxu-${rand(5)}`;
    const pageId = await insertPage(user.id, handle);
    const jwt = await accessTokenFor(user.email);
    const draftWithLink = draftOf(handle, [linkBlock("lnkblk000009", `https://x.${domain}/`)]);
    const save = () =>
      rest(`pages?id=eq.${pageId}`, { method: "PATCH", jwt, body: { draft: draftWithLink } });

    // Not listed yet: the save goes through.
    expect((await save()).status).toBeLessThan(300);
    await postApp(blockPath(), { cookie, body: JSON.stringify({ domain, reason: "e2e" }) });

    const refused = await save();
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "HL005", message: "blocked_link" });

    await postApp(removePath(domain), { cookie });
    expect((await save()).status).toBeLessThan(300);
  });

  test("M7-12 blocked_domains and the impact function are server only: nothing is read or written with the publishable key", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    const user = await makeUser("blsrv");
    const jwt = await accessTokenFor(user.email);
    for (const withJwt of [undefined, jwt]) {
      const who = withJwt ? "signed in" : "anonymous";
      expectDenied(await rest("blocked_domains", { jwt: withJwt }), `${who} reads blocked_domains`);
      expectDenied(
        await rest("blocked_domains", {
          method: "POST",
          jwt: withJwt,
          body: { domain: "evil.example", reason: "x" },
        }),
        `${who} inserts into blocked_domains`,
      );
      expectDenied(
        await rest("blocked_domains?domain=eq.grabify.link", { method: "DELETE", jwt: withJwt }),
        `${who} deletes from blocked_domains`,
      );
      expectDenied(
        await rest("rpc/admin_blocked_domain_impact", {
          method: "POST",
          jwt: withJwt,
          body: { p_domain: "grabify.link" },
        }),
        `${who} calls admin_blocked_domain_impact`,
      );
      expectDenied(await rest("admin_audit", { jwt: withJwt }), `${who} reads admin_audit`);
    }
    const starter = await adminClient()
      .from("blocked_domains")
      .select("domain")
      .eq("domain", "grabify.link");
    expect(starter.data).toHaveLength(1);
    expect(await tenantRaw("mara")).toMatchObject({ status: 200 });
  });
});
