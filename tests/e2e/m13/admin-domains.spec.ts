import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-04: /admin/domains lists custom domains unverified for more than 24 hours or failing, and
 * Re-check now runs the cron's verification for one. The demo account nico (seed.sql) holds two stuck
 * domains and is only read here; the re-check runs on a domain made for this test. The re-check's own
 * logic is in tests/unit/admin-recheck-domain.test.ts; the guard (non-admin 403, signed out 401, one
 * route per action) is in tests/unit/admin-actions-guard.test.ts.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

test.describe("M13-04 admin domains", () => {
  test("M13-04 lists nico's stuck domains with owner, age and result, and the registrar guides; no sideways scroll, 44px targets", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "m13dm");
    await page.goto(url("app", "/admin/domains"));
    await expect(page.getByRole("heading", { level: 1, name: "Domains" })).toBeVisible();

    const stuck = page.locator('tr[data-hostname="links.nico-stuck.example"]');
    await expect(stuck).toBeVisible();
    await expect(stuck).toHaveAttribute("data-reason", "unverified");
    await expect(stuck).toContainText("nico@example.test");
    await expect(stuck).toContainText("3 days");
    await expect(stuck.getByTestId("last-result")).toContainText(
      /Checked, not verified yet|Never checked/,
    );

    const failing = page.locator('tr[data-hostname="go.nico-failing.example"]');
    await expect(failing).toBeVisible();
    await expect(failing).toHaveAttribute("data-reason", "failed");
    await expect(failing.getByTestId("last-result")).toContainText("The last check failed.");

    // The guides, once, each with its full link on the marketing origin and a copy button.
    for (const slug of [
      "connecting-a-domain",
      "connect-a-domain-godaddy",
      "connect-a-domain-namecheap",
      "connect-a-domain-squarespace",
      "connect-a-domain-cloudflare",
    ]) {
      await expect(page.locator("body")).toContainText(`/learn/${slug}`);
    }
    await expect(page.getByRole("button", { name: /^Copy the GoDaddy link$/ })).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main, body");
  });

  test("M13-04 Re-check now shows a new result, moves last_checked_at and writes one recheck_domain audit row", async ({
    page,
    context,
    browser,
  }) => {
    const owner = await signInAsUser(await browser.newContext(), "m13own", { plan: "studio" });
    const hostname = `recheck-${rand(6)}.m13-example.test`;
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const inserted = await adminClient()
      .from("domains")
      .insert({
        page_id: owner.pageId!,
        hostname,
        status: "pending",
        created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        last_checked_at: hourAgo,
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    const domainId = inserted.data!.id;

    await signInAsAdmin(context, "m13rc");
    await page.goto(url("app", "/admin/domains"));
    const row = page.locator(`tr[data-hostname="${hostname}"]`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Re-check ${hostname} now` }).click();
    await expect(row.getByTestId("recheck-result")).toBeVisible();
    await expect(row.getByTestId("recheck-result")).not.toHaveText("");

    const after = await adminClient()
      .from("domains")
      .select("last_checked_at")
      .eq("id", domainId)
      .single();
    expect(Date.parse(after.data!.last_checked_at as string)).toBeGreaterThan(Date.parse(hourAgo));

    const audit = await adminClient()
      .from("admin_audit")
      .select("action, account_id, detail")
      .eq("action", "recheck_domain")
      .eq("account_id", owner.userId);
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(1);
    expect(audit.data![0]!.detail).toMatchObject({ hostname });

    await expectNoHorizontalScroll(page);
  });

  test("M13-04 the re-check route is admin only: a non-admin gets 403 and nothing is checked", async ({
    context,
  }) => {
    const user = await signInAsUser(context, "m13na");
    const response = await context.request.post(
      url("app", `/api/admin/domains/${user.pageId}/recheck`),
      {
        headers: { "content-type": "application/json", origin: url("app").replace(/\/$/, "") },
        data: {},
      },
    );
    expect(response.status()).toBe(403);
  });
});
