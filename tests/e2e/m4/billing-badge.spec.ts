import { expect, test, type Page } from "@playwright/test";
import { emptyDraft, toPublishForm, type Block } from "@/lib/document";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, insertPage, makeUser, rand, uniq } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import {
  deliver,
  eventId,
  postWebhook,
  priceIds,
  seedStubFromEvent,
  signed,
  subscriptionEvent,
} from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll, url } from "../helpers";
import { SERVER_PORT, rawBuffer, tenantGet } from "../m2/publish-helpers";

/**
 * M4-08: the "Made with HYDLNK" badge follows a plan change without a republish. The webhook
 * (signed, M4-03) writes the plan and expires that account's cached pages; the badge decision
 * itself still reads accounts.plan at render time.
 *
 * The first block runs against the shared dev server, which caches nothing: it proves the plan
 * change reaches the page and that the abuse cases do not. The second block proves the cache
 * behaviour (x-nextjs-cache, the query counter) and needs a production build, like
 * tests/e2e/m2/publish-cache.spec.ts:
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm build
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm start -p 3100
 *   HL_PROD_PORT=3100 pnpm test:e2e tests/e2e/m4/billing-badge.spec.ts
 *
 * Custom-host variant (the same flips on a verified custom domain) waits for the domain lookup in
 * src/lib/routing/custom-domain.ts: the tag the webhook expires is the page's, whichever host serves it.
 */

test.afterAll(cleanupUsers);

const BADGE = "Made with HYDLNK";
const REPORT = "Report this page";
const PROD = Boolean(process.env.HL_PROD_PORT);

const link = (id: string, label: string): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url: "https://example.com/x",
});

/** A Free account with a published page and a Stripe customer id (as after its first Checkout). */
async function freeUserWithPage(label: string) {
  const user = await makeUser(label);
  const handle = uniq(label);
  const draft = emptyDraft(handle);
  draft.profile.name = `Zq ${label}`;
  draft.profile.bio = `Bio of ${label}`;
  draft.blocks = [link(`lnk-${rand(6)}`, "Book now")];
  const pageId = await insertPage(user.id, handle, {
    draft,
    published: toPublishForm(draft, null),
    published_at: new Date().toISOString(),
  });
  const customer = `cus_zq${rand(10)}`;
  const { error } = await adminClient()
    .from("accounts")
    .update({ stripe_customer_id: customer })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
  return { ...user, handle, pageId, customer };
}

type Fx = Awaited<ReturnType<typeof freeUserWithPage>>;

const create = (fx: Fx, price: keyof ReturnType<typeof priceIds>, created?: number) =>
  subscriptionEvent({
    type: "customer.subscription.created",
    customer: fx.customer,
    subscriptionId: `sub_zq${rand(10)}`,
    priceId: priceIds()[price],
    accountId: fx.id,
    ...(created ? { created } : {}),
  });

const remove = (fx: Fx, subscriptionId: string, created: number) =>
  subscriptionEvent({
    type: "customer.subscription.deleted",
    customer: fx.customer,
    subscriptionId,
    priceId: priceIds().proMonthly,
    created,
  });

const dev = (handle: string, path = "/") => rawRequest(`${handle}.localhost:3000`, path);

async function publishedOf(pageId: string) {
  const { data, error } = await adminClient()
    .from("pages")
    .select("published, published_at, updated_at")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return JSON.stringify(data);
}

test.describe("M4-08 the badge follows the plan (dev server)", () => {
  test("M4-08 a signed Pro subscription removes the badge on the very next request, a deleted one brings it back", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow: the viewport checks are further down");
    const fx = await freeUserWithPage("bd-flip");
    const before = await publishedOf(fx.pageId);
    const first = await dev(fx.handle);
    expect(first.status).toBe(200);
    expect(first.body).toContain(BADGE);
    expect(first.body).toContain(REPORT);

    const created = create(fx, "proMonthly");
    expect((await deliver(created)).status).toBe(200);
    const pro = await dev(fx.handle);
    expect(pro.status).toBe(200);
    expect(pro.body).not.toContain(BADGE);
    expect(pro.body).toContain(REPORT);

    const studio = subscriptionEvent({
      type: "customer.subscription.updated",
      customer: fx.customer,
      subscriptionId: created.data.object.id,
      priceId: priceIds().studioYearly,
      created: created.created + 1,
    });
    expect((await deliver(studio)).status).toBe(200);
    expect((await dev(fx.handle)).body).not.toContain(BADGE);

    const deleted = remove(fx, created.data.object.id, created.created + 2);
    expect((await deliver(deleted)).status).toBe(200);
    const free = await dev(fx.handle);
    expect(free.body).toContain(BADGE);
    expect(free.body).toContain(REPORT);

    // Nothing was republished: the stored page is exactly what it was.
    expect(await publishedOf(fx.pageId)).toBe(before);
  });

  test("M4-08 abuse: an unsigned POST claiming a Pro subscription is a 400 and the badge stays", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow");
    const fx = await freeUserWithPage("bd-unsigned");
    const body = JSON.stringify(create(fx, "studioMonthly"));
    expect((await postWebhook(body, null)).status).toBe(400);
    expect((await postWebhook(body, "t=1,v1=abc")).status).toBe(400);
    const forged = signed(body, { secret: "whsec_not_the_secret" });
    expect((await postWebhook(forged.body, forged.signature)).status).toBe(400);
    const page = await dev(fx.handle);
    expect(page.body).toContain(BADGE);
    const { data } = await adminClient().from("accounts").select("plan").eq("id", fx.id).single();
    expect(data!.plan).toBe("free");
  });

  test("M4-08 an event for another account's customer never moves this page", async ({}, info) => {
    test.skip(!desktopOnly(info), "a data flow");
    const mine = await freeUserWithPage("bd-mine");
    const theirs = await freeUserWithPage("bd-theirs");
    expect((await deliver(create(theirs, "proMonthly"))).status).toBe(200);
    expect((await dev(theirs.handle)).body).not.toContain(BADGE);
    expect((await dev(mine.handle)).body).toContain(BADGE);
  });
});

async function footer(page: Page) {
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  return {
    footer: await box("[data-page-footer]"),
    column: await box("[data-page-root] .pg-column"),
  };
}

test.describe("M4-08 the page footer with and without the badge", () => {
  test("M4-08 Free: the badge is a 44px target inside the page column and nothing scrolls sideways", async ({
    page,
  }) => {
    const fx = await freeUserWithPage("bd-ui-free");
    await page.goto(url(fx.handle));
    const badge = page.getByRole("link", { name: BADGE });
    await expect(badge).toHaveCount(1);
    const box = (await badge.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const { footer: f, column } = await footer(page);
    // Inside the column, and the badge-and-report group is centred in it.
    expect(box.x).toBeGreaterThanOrEqual(column.x - 1);
    const report = (await page.getByRole("link", { name: REPORT }).boundingBox())!;
    const left = Math.min(box.x, report.x);
    const right = Math.max(box.x + box.width, report.x + report.width);
    expect(Math.abs((left + right) / 2 - (column.x + column.width / 2))).toBeLessThan(3);
    expect(f.width).toBeLessThanOrEqual(column.width + 1);
    await expectNoHorizontalScroll(page);
  });

  test("M4-08 after the webhook flips the account to Pro the page has no badge and no empty gap above the report link", async ({
    page,
  }) => {
    const fx = await freeUserWithPage("bd-ui-pro");
    await page.goto(url(fx.handle));
    await expect(page.getByRole("link", { name: BADGE })).toHaveCount(1);
    const withBadge = await footer(page);

    expect((await deliver(create(fx, "proYearly"))).status).toBe(200);
    await page.goto(url(fx.handle));
    await expect(page.locator("[data-page-root]")).toBeVisible();
    await expect(page.getByRole("link", { name: BADGE })).toHaveCount(0);
    const reportLink = page.getByRole("link", { name: REPORT });
    await expect(reportLink).toHaveCount(1);
    const { footer: f, column } = await footer(page);
    const report = (await reportLink.boundingBox())!;
    // The footer's own top padding is all that sits above the link: no space is kept for the badge.
    expect(report.y - f.y).toBeLessThanOrEqual(30);
    expect(Math.abs(report.x + report.width / 2 - (column.x + column.width / 2))).toBeLessThan(3);
    // A page without the badge is no taller than one with it.
    expect(f.height).toBeLessThanOrEqual(withBadge.footer.height + 1);
    await expectNoHorizontalScroll(page);
  });
});

// ---------------------------------------------------------------------------------------------
// The cache (production build only)
// ---------------------------------------------------------------------------------------------

const cacheState = (res: { headers: Record<string, unknown> }) =>
  String(res.headers["x-nextjs-cache"] ?? "");

async function queryCount(handle: string): Promise<number> {
  const res = await tenantGet(handle, "/hl-query-count");
  expect(res.status, "the server must run with HYDLNK_QUERY_COUNTER=1").toBe(200);
  return (JSON.parse(res.text) as { count: number }).count;
}

/**
 * The same signed delivery, to the production build's app host. The webhook reads the
 * subscription's current state from Stripe (the stub), so the stub is made to match the event first.
 */
async function deliverProd(payload: object) {
  await seedStubFromEvent(payload);
  const { body, signature } = signed(payload);
  return rawBuffer(`app.localhost:${SERVER_PORT}`, "/api/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body,
  });
}

test.describe("M4-08 the cache follows the plan (production build)", () => {
  test.skip(!PROD, "needs a production build: set HL_PROD_PORT (see the header)");
  test.describe.configure({ mode: "serial" });

  test("M4-08 the webhook expires only that account's pages: one regeneration, then a HIT with no query; other accounts stay HIT", async () => {
    const fx = await freeUserWithPage("bd-cache");
    const other = await freeUserWithPage("bd-cother");
    for (const handle of [fx.handle, other.handle]) {
      await tenantGet(handle);
      expect(cacheState(await tenantGet(handle)), handle).toBe("HIT");
    }
    const warm = await tenantGet(fx.handle);
    expect(warm.text).toContain(BADGE);
    const countFx = await queryCount(fx.handle);
    const countOther = await queryCount(other.handle);

    const created = create(fx, "proMonthly");
    const response = await deliverProd(created);
    expect(response.status).toBe(200);

    // The very next request regenerates (one query) without the badge ...
    const next = await tenantGet(fx.handle);
    expect(next.status).toBe(200);
    expect(next.text).not.toContain(BADGE);
    expect(cacheState(next)).not.toBe("HIT");
    expect(await queryCount(fx.handle)).toBe(countFx + 1);
    // ... and the one after is served from the cache, running no query at all.
    const again = await tenantGet(fx.handle);
    expect(cacheState(again)).toBe("HIT");
    expect(again.text).not.toContain(BADGE);
    expect(await queryCount(fx.handle)).toBe(countFx + 1);

    // Only that account was refreshed.
    const untouched = await tenantGet(other.handle);
    expect(cacheState(untouched)).toBe("HIT");
    expect(untouched.text).toContain(BADGE);
    expect(await queryCount(other.handle)).toBe(countOther);

    // Cancelling brings the badge back the same way.
    const deleted = remove(fx, created.data.object.id, created.created + 1);
    expect((await deliverProd(deleted)).status).toBe(200);
    const back = await tenantGet(fx.handle);
    expect(back.text).toContain(BADGE);
    expect(await queryCount(fx.handle)).toBe(countFx + 2);
    expect(cacheState(await tenantGet(fx.handle))).toBe("HIT");
  });

  test("M4-08 a redelivery of the same event expires nothing and runs no query", async () => {
    const fx = await freeUserWithPage("bd-redel");
    const event = { ...create(fx, "proMonthly"), id: eventId() };
    expect((await deliverProd(event)).status).toBe(200);
    await tenantGet(fx.handle);
    expect(cacheState(await tenantGet(fx.handle))).toBe("HIT");
    const count = await queryCount(fx.handle);
    expect((await deliverProd(event)).status).toBe(200);
    expect(cacheState(await tenantGet(fx.handle))).toBe("HIT");
    expect(await queryCount(fx.handle)).toBe(count);
  });

  test("M4-08 an unsigned POST claiming a Pro subscription leaves the cached page, and its badge, alone", async () => {
    const fx = await freeUserWithPage("bd-cuns");
    await tenantGet(fx.handle);
    expect(cacheState(await tenantGet(fx.handle))).toBe("HIT");
    const count = await queryCount(fx.handle);
    const response = await rawBuffer(`app.localhost:${SERVER_PORT}`, "/api/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(create(fx, "studioMonthly")),
    });
    expect(response.status).toBe(400);
    const after = await tenantGet(fx.handle);
    expect(cacheState(after)).toBe("HIT");
    expect(after.text).toContain(BADGE);
    expect(await queryCount(fx.handle)).toBe(count);
  });
});
