import { expect, test } from "@playwright/test";
import { addDomain } from "@/lib/domains/core";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { addCalls } from "../fixtures/vercel-stub";
import { hostnameFor, makeSite, realDeps } from "../m4/domains-core-helpers";
import { setSuspended } from "../m5/admin-helpers";

/**
 * M13-12: the one write door of M5-09 that had no test when the earlier spec was written, because the
 * domain flow did not exist: Add domain. The earlier specs (tests/e2e/m5/suspend-writes.spec.ts,
 * tests/e2e/m4/domains-ui.spec.ts, supabase/tests/database/101-admin.test.sql) prove the rest: draft and
 * theme writes with the publishable key, create page, claim, upload and publish refused with 403
 * account_suspended, the banner, every disabled control (Add domain included) and Sign out.
 *
 * Add domain is a Server Action over `addDomain`, which cannot be posted to from a spec; this runs the
 * real function against the real database and the local Vercel stub: refused 403 account_suspended
 * before any Vercel call and before any row, then accepted once the account is unsuspended.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

test.describe("M5-09 Add domain is refused for a suspended owner (proved in Wave N)", () => {
  test("M5-09 addDomain answers 403 account_suspended with no Vercel call and no domains row; unsuspended, the same call works", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const site = await makeSite("m13sw");
    const hostname = hostnameFor("m13sw");
    await setSuspended(site.user.id, true);

    const refused = await addDomain(realDeps(), site.user.id, { hostname, pageId: site.pageId });
    expect(refused).toMatchObject({ ok: false, error: "account_suspended", status: 403 });
    const rows = await adminClient().from("domains").select("id").eq("hostname", hostname);
    expect(rows.data ?? []).toHaveLength(0);
    expect(await addCalls(hostname)).toHaveLength(0);

    await setSuspended(site.user.id, false);
    const added = await addDomain(realDeps(), site.user.id, { hostname, pageId: site.pageId });
    expect(added.ok, JSON.stringify(added)).toBe(true);
    const stored = await adminClient().from("domains").select("id").eq("hostname", hostname);
    expect(stored.data ?? []).toHaveLength(1);
  });
});
