import { expect as baseExpect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { deliver, ensureStripeStub, priceIds, subscriptionEvent } from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { tenantGet } from "../m2/publish-helpers";
import { billingUser, type BillingUser } from "./billing-helpers";
import { authCookies, cookieHeader } from "../fixtures/http";
import { removalCalls } from "../fixtures/vercel-stub";
import {
  addVerifiedDomains,
  analyticsMigrationLanded,
  analyticsScreenLanded,
  captureAction,
  customGet,
  customHostRoutingLanded,
  customHostname,
  domainActionsLanded,
  domainHostsOf,
  domainsScreenLanded,
  replayAction,
} from "./lifecycle-helpers";

/** The machine runs the other Wave E jobs' suites at the same time: give each assertion room. */
const expect = baseExpect.configure({ timeout: 25_000 });

/**
 * M4-33, the parts of the downgrade that depend on the other Wave E jobs: the custom host that
 * keeps answering 200, the domain write that is refused (and the one that is allowed), and the
 * analytics gating that applies the moment the plan flips. The core of the downgrade (nothing is
 * deleted, only new writes are refused, the over-limit meters, the restore on a later
 * customer.subscription.created, the page, theme and upload refusals) is proven in
 * limits-downgrade.spec.ts; the plan flip here is the same signed webhook.
 *
 * A spec whose dependency is not in the tree yet is skipped with the reason, so a run that still
 * shows a skip tells the integrator what is missing.
 */

test.afterAll(cleanupUsers);
test.beforeAll(ensureStripeStub);
test.describe.configure({ timeout: 150_000 });

const admin = () => adminClient();

async function planOf(userId: string): Promise<string> {
  const { data, error } = await admin().from("accounts").select("plan").eq("id", userId).single();
  if (error) throw new Error(error.message);
  return data.plan as string;
}

async function waitForPlan(userId: string, want: string) {
  await expect.poll(() => planOf(userId), { timeout: 30_000 }).toBe(want);
}

let clock = Math.floor(Date.now() / 1000);

/** A signed customer.subscription.deleted for the user's own subscription: the plan becomes Free. */
async function downgrade(user: BillingUser) {
  const response = await deliver(
    subscriptionEvent({
      type: "customer.subscription.deleted",
      created: ++clock,
      customer: user.customer!,
      subscriptionId: user.subscription!,
      status: "canceled",
      priceId: priceIds().proMonthly,
      accountId: user.userId,
    }),
  );
  expect(response.status).toBe(200);
  await waitForPlan(user.userId, "free");
}

/** A signed customer.subscription.created for Pro: add rights come back. */
async function restorePro(user: BillingUser) {
  const response = await deliver(
    subscriptionEvent({
      type: "customer.subscription.created",
      created: ++clock + 60,
      customer: user.customer!,
      subscriptionId: `sub_zq${rand(10)}`,
      status: "active",
      priceId: priceIds().proMonthly,
      accountId: user.userId,
    }),
  );
  expect(response.status).toBe(200);
  await waitForPlan(user.userId, "pro");
}

const hasBadge = async (host: string, custom = false) => {
  const res = custom ? await customGet(host) : await tenantGet(host);
  const text = "text" in res ? res.text : res.body;
  return text.includes("Made with HYDLNK");
};

async function domainRows(pageId: string) {
  const { data, error } = await admin()
    .from("domains")
    .select("id, page_id, hostname, status, verified_at, updated_at")
    .eq("page_id", pageId)
    .order("hostname");
  if (error) throw new Error(error.message);
  return data;
}

test.describe("M4-33 a downgraded account keeps its custom domain", () => {
  test("M4-33 the verified domain row and its custom host survive the downgrade, the badge returns on that host, and the upgrade changes nothing but the plan", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    test.skip(
      !customHostRoutingLanded(),
      "custom hosts do not serve their page yet (resolveCustomDomain is still the TODO(M4) stub, domains-core)",
    );
    const user = await billingUser(context, { label: "dgc", plan: "pro" });
    const host = customHostname("dgc");
    await addVerifiedDomains(user.pageId, [host]);
    const before = await domainRows(user.pageId);
    expect(before).toHaveLength(1);

    // On Pro: the custom host serves the page and carries no badge.
    expect((await customGet(host)).status).toBe(200);
    expect(await hasBadge(host, true)).toBe(false);

    await downgrade(user);

    // Over its limit (1 domain against 0), and nothing happened to it: the row is unchanged and
    // the host answers 200 (what happens to over-limit domains is deliberately not changed here),
    // now with the badge.
    expect(await domainRows(user.pageId)).toEqual(before);
    await expect
      .poll(async () => hasBadge(host, true), {
        timeout: 30_000,
        message: "badge on the custom host",
      })
      .toBe(true);
    expect((await customGet(host)).status).toBe(200);
    expect((await tenantGet(user.handle)).status).toBe(200);

    // The upgrade restores add rights and alters no row.
    await restorePro(user);
    expect(await domainRows(user.pageId)).toEqual(before);
    await expect.poll(async () => hasBadge(host, true), { timeout: 30_000 }).toBe(false);
    expect((await customGet(host)).status).toBe(200);
  });

  test("M4-33 with the publishable key a direct insert, update or delete of a domain is refused after the downgrade, and the row is untouched", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "dgj", plan: "pro" });
    const host = customHostname("dgj");
    await addVerifiedDomains(user.pageId, [host]);
    const before = await domainRows(user.pageId);
    await downgrade(user);

    const token = await accessTokenFor(user.email);
    const lateHost = customHostname("dgj-late");
    const insert = await restAs(token, "/domains", {
      method: "POST",
      body: { page_id: user.pageId, hostname: lateHost, status: "verified" },
    });
    expect([401, 403]).toContain(insert.status);
    const update = await restAs(token, `/domains?hostname=eq.${host}`, {
      method: "PATCH",
      body: { page_id: user.pageId, status: "error" },
    });
    expect([401, 403]).toContain(update.status);
    const remove = await restAs(token, `/domains?hostname=eq.${host}`, { method: "DELETE" });
    expect([401, 403]).toContain(remove.status);

    expect(await domainHostsOf([user.pageId])).toEqual([host]);
    expect(await domainRows(user.pageId)).toEqual(before);
    // The database refuses past the Free limit for any writer, the secret key included.
    const viaSecretKey = await admin()
      .from("domains")
      .insert({ page_id: user.pageId, hostname: lateHost });
    expect(viaSecretKey.error?.code).toBe("HL003");
  });
});

test.describe("M4-33 the Domains screen of a downgraded account", () => {
  test("M4-33 shows the locked card and keeps the domain's own card, without overflow", async ({
    page,
    context,
  }) => {
    test.skip(
      !domainsScreenLanded(),
      "the Domains screen is still the placeholder (domains UI job)",
    );
    const user = await billingUser(context, { label: "dgs", plan: "pro" });
    const host = customHostname("dgs");
    await addVerifiedDomains(user.pageId, [host]);
    await downgrade(user);

    await page.goto(url("app", "/domains"));
    const locked = page.locator("[data-domains-locked]");
    await expect(locked).toBeVisible();
    await expect(locked).toContainText("Custom domains start on Pro.");
    // No way to add: no input anywhere in the card.
    await expect(page.locator("[data-custom-domain-card] input")).toHaveCount(0);
    // The kept domain still has its card, with the controls to look after it.
    const card = page.locator(`[data-domain-card="${host}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Remove domain" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
  });

  test("M4-33 adding a domain is refused with the plan message, removing the kept one is allowed and the meter drops, and the upgrade brings the form back", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    test.skip(
      !domainActionsLanded() || !domainsScreenLanded(),
      "the domain server actions or the Domains screen are not built yet (domains-core, domains UI)",
    );
    const user = await billingUser(context, { label: "dgd", plan: "pro" });

    // Pro with a free slot: capture the add request the form sends (it never leaves the browser),
    // so the identical request can be replayed with this session after the downgrade.
    await page.goto(url("app", "/domains"));
    const form = page.locator("[data-add-domain-form]");
    await form.getByLabel("Domain").fill(customHostname("dgd-new"));
    const recorded = await captureAction(page, "**/domains", () =>
      form.getByRole("button", { name: "Add domain" }).click(),
    );

    // The account now holds its one domain, then loses Pro.
    const host = customHostname("dgd");
    await addVerifiedDomains(user.pageId, [host]);
    await downgrade(user);

    const refused = await replayAction(
      recorded,
      "/domains",
      cookieHeader(await authCookies(context)),
    );
    expect(refused.body).toContain("plan_required");
    expect(refused.body).toContain("Custom domains start on Pro.");
    expect(refused.body).not.toContain('"ok":true');
    expect(await domainHostsOf([user.pageId])).toEqual([host]);

    // Removing is allowed: the card goes, the project loses the hostname, the meter drops.
    await page.goto(url("app", "/domains"));
    const card = page.locator(`[data-domain-card="${host}"]`);
    await card.getByRole("button", { name: "Remove domain" }).click();
    await card.getByRole("group").getByRole("button", { name: "Remove domain" }).click();
    await expect(card).toHaveCount(0);
    expect(await domainHostsOf([user.pageId])).toEqual([]);
    expect((await removalCalls(host)).length).toBeGreaterThanOrEqual(1);
    await page.goto(url("app", "/settings"));
    await expect(page.locator('[data-meter="domains"]')).toContainText("Not included");

    // A later Pro subscription brings the add form back, no data lost.
    await restorePro(user);
    await page.goto(url("app", "/domains"));
    await expect(page.locator("[data-add-domain-form]")).toBeVisible();
    await expect(page.locator("[data-domains-locked]")).toHaveCount(0);
  });
});

/**
 * Raw events for three UTC days (5, 45 and 200 days ago) rolled up through the real nightly
 * function: the secret key may insert events and run the rollup but cannot write the stats tables
 * itself. Each day gets one view (referrer, device and country set) and one click, so the day has a
 * page-level and a block-level daily_stats row and three daily_dim_stats rows.
 */
async function seedStats(pageId: string) {
  const day = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const recent = day(5);
  const old = [day(45), day(200)];
  for (const d of [recent, ...old]) {
    const events = [
      {
        page_id: pageId,
        block_id: "",
        type: "view",
        ts: `${d}T12:00:00Z`,
        referrer: "example.test",
        device: "mobile",
        country: "US",
        visitor_hash: `zq-${rand(12)}`,
      },
      {
        page_id: pageId,
        block_id: "blkzq0001",
        type: "click",
        ts: `${d}T12:01:00Z`,
        referrer: "example.test",
        device: "mobile",
        country: "US",
        visitor_hash: `zq-${rand(12)}`,
      },
    ];
    const inserted = await admin().from("events").insert(events);
    if (inserted.error) throw new Error(`seeding events failed: ${inserted.error.message}`);
    const rolled = await admin().rpc("rollup_daily_stats", { p_day: d });
    if (rolled.error) throw new Error(`rollup of ${d} failed: ${rolled.error.message}`);
  }
  return { recent, old };
}

test.describe("M4-33 analytics gating applies the moment the plan flips", () => {
  test("M4-33 after the downgrade the owner's JWT reads only 30 days of daily_stats and no daily_dim_stats; the upgrade brings everything back", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    test.skip(
      !analyticsMigrationLanded(),
      "the analytics migration (daily_dim_stats, the Free window policies) is not in the tree yet (analytics-db)",
    );
    const user = await billingUser(context, { label: "dga", plan: "pro" });
    const { recent, old } = await seedStats(user.pageId);
    const token = await accessTokenFor(user.email);
    const stats = async () =>
      (
        await restAs(
          token,
          `/daily_stats?page_id=eq.${user.pageId}&block_id=eq.&select=day&order=day`,
        )
      ).body as { day: string }[];
    const dims = async () =>
      (await restAs(token, `/daily_dim_stats?page_id=eq.${user.pageId}&select=day,dim`))
        .body as unknown[];

    // Pro: every row, the breakdowns included.
    expect((await stats()).map((r) => r.day)).toEqual([...old].sort().concat(recent));
    expect(await dims()).toHaveLength(9);

    await downgrade(user);

    // Free: the last 30 days only, no breakdowns, at once (no sweep, no cache).
    expect((await stats()).map((r) => r.day)).toEqual([recent]);
    expect(await dims()).toEqual([]);
    // The abuse shape of M4-30: older rows by explicit filter are just as empty.
    const olderThan30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    expect(
      (await restAs(token, `/daily_stats?page_id=eq.${user.pageId}&day=lt.${olderThan30}`)).body,
    ).toEqual([]);
    expect((await restAs(token, `/daily_dim_stats?page_id=eq.${user.pageId}`)).body).toEqual([]);
    // Nothing was deleted: the rows are all still there for the secret key.
    const kept = await admin().from("daily_stats").select("day").eq("page_id", user.pageId);
    expect(kept.data).toHaveLength(6); // a page-level and a block-level row for each of the 3 days
    const keptDims = await admin().from("daily_dim_stats").select("day").eq("page_id", user.pageId);
    expect(keptDims.data).toHaveLength(9);

    await restorePro(user);
    expect((await stats()).map((r) => r.day)).toEqual([...old].sort().concat(recent));
    expect(await dims()).toHaveLength(9);
  });

  test("M4-33 the Analytics screen locks 90 days and the breakdowns the moment the plan flips, and unlocks them again, without overflow", async ({
    page,
    context,
  }) => {
    test.skip(
      !analyticsScreenLanded(),
      "the Analytics screen is still the placeholder (analytics UI job)",
    );
    const user = await billingUser(context, { label: "dgu", plan: "pro" });
    // On Pro: 90 days is data, the breakdown cards are open.
    await page.goto(url("app", "/analytics?range=90"));
    await expect(page.getByTestId("upgrade-card")).toHaveCount(0);
    await page.goto(url("app", "/analytics?range=30"));
    await expect(page.getByTestId("locked-card")).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await downgrade(user);

    // On Free, at once: 90 days (and a year) is the upgrade card instead of data ...
    for (const range of ["90", "365"]) {
      await page.goto(url("app", `/analytics?range=${range}`));
      const upgrade = page.getByTestId("upgrade-card");
      await expect(upgrade).toBeVisible();
      await expect(upgrade.getByText("Longer ranges come with Pro")).toBeVisible();
      await expect(upgrade.getByRole("link", { name: "Upgrade to Pro" })).toHaveAttribute(
        "href",
        /\/settings#plans$/,
      );
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, '[data-testid="upgrade-card"], [data-testid="locked-card"]');
    }
    // ... and 7 and 30 days still work, with the three breakdown cards locked.
    for (const range of ["7", "30"]) {
      await page.goto(url("app", `/analytics?range=${range}`));
      await expect(page.getByTestId("upgrade-card")).toHaveCount(0);
      const locked = page.getByTestId("locked-card");
      await expect(locked).toHaveCount(3);
      await expect(locked.first().getByText("Included with Pro")).toBeVisible();
      await expect(locked.first().getByRole("link", { name: "See plans" })).toHaveAttribute(
        "href",
        /\/settings#plans$/,
      );
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, '[data-testid="upgrade-card"], [data-testid="locked-card"]');
    }

    // The upgrade brings 90 days and the breakdowns back.
    await restorePro(user);
    await page.goto(url("app", "/analytics?range=90"));
    await expect(page.getByTestId("upgrade-card")).toHaveCount(0);
    await page.goto(url("app", "/analytics?range=30"));
    await expect(page.getByTestId("locked-card")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});
