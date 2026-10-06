import { expect as baseExpect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { authCookies, cookieHeader } from "../fixtures/http";
import {
  addStubSubscription,
  ensureStripeStub,
  failStub,
  priceIds,
  stubCalls,
  stubSubscriptionStatus,
} from "../fixtures/stripe-stub";
import { failVercelStub, removalCalls } from "../fixtures/vercel-stub";
import { expectNoHorizontalScroll, url } from "../helpers";
import { billingUser } from "./billing-helpers";
import {
  addVerifiedDomains,
  captureAction,
  cleanupSeededImages,
  customGet,
  customHostRoutingLanded,
  customHostname,
  domainHostsOf,
  imagesOf,
  pageRowExists,
  refusedAsSignedOut,
  replayAction,
  seedImages,
  userExists,
} from "./lifecycle-helpers";

/** The machine runs the other Wave E jobs' suites at the same time: give each assertion room. */
const expect = baseExpect.configure({ timeout: 25_000 });

/**
 * M4-34 as one flow, over HTTP against the Stripe stub, the Vercel stub, the real Storage bucket and
 * the real database: deleting an account cancels each subscription, then takes each custom domain
 * off the project, then deletes the uploaded images, then the user. The pieces are proven one at a
 * time elsewhere (billing-delete.spec.ts: Stripe, the modal, the abuse cases with a subscription;
 * domains-vercel.spec.ts: the Vercel failure; tests/unit/account-delete-*.test.ts and
 * billing-delete-account.test.ts: each step and their order with mocks). This file proves the whole
 * chain with all three present: the order and the stop-at-the-first-failure rule seen from the two
 * stubs' request logs, exactly one cancel per subscription across a retry, the abuse cases with
 * domains and images in play, and that every custom host answers 404 at once afterwards.
 */

test.afterAll(async () => {
  await cleanupSeededImages();
  await cleanupUsers();
});
test.beforeAll(ensureStripeStub);
test.describe.configure({ timeout: 150_000 });

const settings = () => url("app", "/settings");
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Delete your account?" });
const CANCEL_MESSAGE = "We couldn’t cancel your subscription. Try again.";
const DOMAIN_MESSAGE = "We couldn’t remove your custom domain. Try again.";

async function openDialog(page: Page) {
  await page.goto(settings());
  await page.locator("main").getByRole("button", { name: "Delete account" }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

const cancelCalls = (subscription: string) =>
  stubCalls("DELETE", `/v1/subscriptions/${subscription}`);
const listCalls = (customer: string) => stubCalls("GET", "/v1/subscriptions", customer);

test.describe("M4-34 the whole chain: Stripe, then Vercel, then files, then the user", () => {
  test("M4-34 each failure stops everything after it, a retry cancels each subscription exactly once, and the log shows the cancel and remove requests", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "lo", plan: "studio" });
    const second = `sub_zq${rand(10)}`;
    await addStubSubscription({
      id: second,
      customer: user.customer!,
      priceId: priceIds().studioYearly,
    });
    const hosts = [customHostname("lo-a"), customHostname("lo-b")];
    await addVerifiedDomains(user.pageId, hosts);
    const images = await seedImages(user.userId, 3);
    expect(await imagesOf(user.userId)).toEqual([...images].sort());

    // ---- Stripe cannot cancel: the Vercel step and everything after it never starts.
    await failStub("DELETE", `/v1/subscriptions/${user.subscription}`);
    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(CANCEL_MESSAGE);
    for (const host of hosts)
      expect(await removalCalls(host), `no removal for ${host}`).toEqual([]);
    expect(await imagesOf(user.userId)).toEqual([...images].sort());
    expect(await userExists(user.userId)).toBe(true);
    expect(await domainHostsOf([user.pageId])).toEqual([...hosts].sort());

    // ---- Stripe recovers, Vercel cannot remove one of the domains: the subscriptions are
    // canceled by now (a failed delete never leaves a paying zombie), but the files and the user
    // are untouched and the dialog says what to retry.
    await failVercelStub(hosts[1]!, 500, 1);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(DOMAIN_MESSAGE);
    await expect(page).toHaveURL(settings());
    expect(await stubSubscriptionStatus(user.subscription!)).toBe("canceled");
    expect(await stubSubscriptionStatus(second)).toBe("canceled");
    expect((await removalCalls(hosts[1]!)).length).toBeGreaterThanOrEqual(1);
    expect(await imagesOf(user.userId)).toEqual([...images].sort());
    expect(await userExists(user.userId)).toBe(true);
    expect(await pageRowExists(user.pageId)).toBe(true);
    expect(await domainHostsOf([user.pageId])).toEqual([...hosts].sort());
    const cancelsAfterVercelFailure =
      (await cancelCalls(user.subscription!)).length + (await cancelCalls(second)).length;

    // ---- Everything recovers: the same dialog finishes the job.
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
    expect(await userExists(user.userId)).toBe(false);
    expect(await imagesOf(user.userId)).toEqual([]);
    expect(await domainHostsOf([user.pageId])).toEqual([]);
    expect(await pageRowExists(user.pageId)).toBe(false);

    // Every domain went through the Vercel stub, with the one that failed asked twice.
    for (const host of hosts) {
      const calls = await removalCalls(host);
      expect(calls.length, `a removal for ${host}`).toBeGreaterThanOrEqual(1);
      expect(calls.every((call) => call.hasBearer)).toBe(true);
    }
    expect((await removalCalls(hosts[1]!)).length).toBeGreaterThanOrEqual(2);

    // Stripe: two subscriptions, one cancel each, plus the single injected failure; the retries
    // that came after the subscriptions were canceled sent no further cancel.
    const total =
      (await cancelCalls(user.subscription!)).length + (await cancelCalls(second)).length;
    expect(total).toBe(3);
    expect(total).toBe(cancelsAfterVercelFailure);

    // The handle answers 404 at once and is free again.
    expect((await customGet(`${user.handle}.localhost:3000`)).status).toBe(404);
    const { data: claimed } = await adminClient()
      .from("pages")
      .select("id")
      .eq("handle", user.handle);
    expect(claimed).toEqual([]);
  });

  test("M4-34 after the deletion every custom host answers 404 at once, even one that was just served from cache", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    test.skip(
      !customHostRoutingLanded(),
      "custom hosts do not serve their page yet (resolveCustomDomain is still the TODO(M4) stub, domains-core)",
    );
    const user = await billingUser(context, { label: "lc", plan: "studio" });
    const hosts = [customHostname("lc-a"), customHostname("lc-b")];
    await addVerifiedDomains(user.pageId, hosts);
    // Warm whatever the host lookup or the page cache keeps: a stale answer is the failure.
    for (const host of hosts) {
      for (let i = 0; i < 3; i++) expect((await customGet(host)).status, host).toBe(200);
    }

    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);

    // Immediately: no polling, no waiting for a cache window.
    for (const host of hosts) expect((await customGet(host)).status, host).toBe(404);
    expect((await customGet(`${user.handle}.localhost:3000`)).status).toBe(404);
    for (const host of hosts) expect((await removalCalls(host)).length).toBeGreaterThanOrEqual(1);
  });
});

test.describe("M4-34 abuse, with custom domains and images in play", () => {
  test("M4-34 a session-less replay of the delete request removes no domain, no image and cancels nothing", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "la-anon", plan: "pro" });
    const host = customHostname("la-anon");
    await addVerifiedDomains(user.pageId, [host]);
    const images = await seedImages(user.userId, 2);

    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    const recorded = await captureAction(page, "**/settings", () =>
      dialog.getByRole("button", { name: "Delete account" }).click(),
    );

    const response = await replayAction(recorded, "/settings");
    expect(
      refusedAsSignedOut(response),
      `status ${response.status}, location "${response.location}"`,
    ).toBe(true);
    expect(await userExists(user.userId)).toBe(true);
    expect(await removalCalls(host)).toEqual([]);
    expect(await imagesOf(user.userId)).toEqual([...images].sort());
    expect(await listCalls(user.customer!)).toHaveLength(0);
    expect(await cancelCalls(user.subscription!)).toHaveLength(0);
    expect(await stubSubscriptionStatus(user.subscription!)).toBe("active");
    expect(await domainHostsOf([user.pageId])).toEqual([host]);
  });

  test("M4-34 a request signed in as someone else cannot delete the account the form was typed for", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const victim = await billingUser(context, { label: "la-victim", plan: "pro" });
    const victimHost = customHostname("la-victim");
    await addVerifiedDomains(victim.pageId, [victimHost]);
    const victimImages = await seedImages(victim.userId, 2);

    // The victim's own confirmed request, captured and never sent.
    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(victim.handle);
    const recorded = await captureAction(page, "**/settings", () =>
      dialog.getByRole("button", { name: "Delete account" }).click(),
    );

    // Another signed-in user sends that exact body with their own session.
    const attackerContext = await browser.newContext();
    const attacker = await billingUser(attackerContext, { label: "la-attacker", plan: "pro" });
    const attackerHost = customHostname("la-attacker");
    await addVerifiedDomains(attacker.pageId, [attackerHost]);
    const attackerCookie = cookieHeader(await authCookies(attackerContext));
    await attackerContext.close();
    const response = await replayAction(recorded, "/settings", attackerCookie);
    expect(response.status).toBeLessThan(500);

    // The handle in the body is the victim's, not the session user's: refused before any step.
    expect(await userExists(attacker.userId)).toBe(true);
    expect(await userExists(victim.userId)).toBe(true);
    for (const host of [victimHost, attackerHost]) expect(await removalCalls(host)).toEqual([]);
    expect(await imagesOf(victim.userId)).toEqual([...victimImages].sort());
    for (const who of [victim, attacker]) {
      expect(await listCalls(who.customer!), who.handle).toHaveLength(0);
      expect(await cancelCalls(who.subscription!), who.handle).toHaveLength(0);
      expect(await stubSubscriptionStatus(who.subscription!)).toBe("active");
    }
  });

  test("M4-34 a wrong confirmation is refused on the server before any Stripe, Vercel or Storage call", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "la-wrong", plan: "pro" });
    const host = customHostname("la-wrong");
    await addVerifiedDomains(user.pageId, [host]);
    const images = await seedImages(user.userId, 2);

    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(`${user.handle}-x`);
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    await expect(confirm).toBeDisabled();
    // Past the guard rail in the browser: the server still refuses.
    await confirm.evaluate((el) => ((el as HTMLButtonElement).disabled = false));
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText("doesn’t match");
    expect(await userExists(user.userId)).toBe(true);
    expect(await listCalls(user.customer!)).toHaveLength(0);
    expect(await cancelCalls(user.subscription!)).toHaveLength(0);
    expect(await removalCalls(host)).toEqual([]);
    expect(await imagesOf(user.userId)).toEqual([...images].sort());
    expect(await domainHostsOf([user.pageId])).toEqual([host]);
  });

  test("M4-34 ids, hostnames and paths smuggled into the form remove nothing of another account's", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const victimContext = await browser.newContext();
    const victim = await billingUser(victimContext, { label: "la-v2", plan: "pro" });
    await victimContext.close();
    const victimHost = customHostname("la-v2");
    await addVerifiedDomains(victim.pageId, [victimHost]);
    const victimImages = await seedImages(victim.userId, 2);

    const me = await billingUser(context, { label: "la-me", plan: "pro" });
    const myHost = customHostname("la-me");
    await addVerifiedDomains(me.pageId, [myHost]);
    const myImages = await seedImages(me.userId, 1);
    expect(myImages).toHaveLength(1);

    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(me.handle);
    await page.evaluate(
      ({ pageId, hostname, userId }) => {
        const form = document.querySelector("dialog form")!;
        const fields: Record<string, string> = {
          pageId,
          page_id: pageId,
          pageIds: pageId,
          hostname,
          domain: hostname,
          domains: hostname,
          userId,
          uid: userId,
          prefix: `${userId}/`,
          path: `${userId}/`,
          bucket: "page-media",
        };
        for (const [name, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
      },
      { pageId: victim.pageId, hostname: victimHost, userId: victim.userId },
    );
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);

    // Mine is gone, theirs is whole.
    expect(await userExists(me.userId)).toBe(false);
    expect(await imagesOf(me.userId)).toEqual([]);
    expect((await removalCalls(myHost)).length).toBeGreaterThanOrEqual(1);
    expect(await userExists(victim.userId)).toBe(true);
    expect(await removalCalls(victimHost)).toEqual([]);
    expect(await domainHostsOf([victim.pageId])).toEqual([victimHost]);
    expect(await imagesOf(victim.userId)).toEqual([...victimImages].sort());
    expect(await cancelCalls(victim.subscription!)).toHaveLength(0);
    expect(await stubSubscriptionStatus(victim.subscription!)).toBe("active");
  });
});

test.describe("M4-34 the dialog when the domain step fails", () => {
  test("M4-34 the failure line wraps inside the dialog at both widths, nothing overflows, the buttons stay 44px tall", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "ll", plan: "pro" });
    const host = customHostname("ll");
    await addVerifiedDomains(user.pageId, [host]);

    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    // Injected last: the stub is shared, and another job's cleanup clears every pending failure.
    await failVercelStub(host, 500, 1);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toHaveText(DOMAIN_MESSAGE);
    // The subscription line is still above the confirmation field next to the error.
    await expect(dialog.getByText("Your Pro subscription will be canceled.")).toBeVisible();

    await expectNoHorizontalScroll(page);
    const width = page.viewportSize()!.width;
    const box = (await dialog.boundingBox())!;
    const alertBox = (await alert.boundingBox())!;
    expect(alertBox.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    for (const control of [
      dialog.getByLabel("Type your handle to confirm"),
      dialog.getByRole("button", { name: "Cancel" }),
      dialog.getByRole("button", { name: "Delete account" }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    if (width >= 1000) {
      expect(box.width).toBeLessThanOrEqual(440.5);
      expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    } else {
      // Phone: full-width, stacked buttons.
      const buttons = await dialog.getByRole("button").all();
      const boxes = [];
      for (const button of buttons) boxes.push((await button.boundingBox())!);
      for (const b of boxes) expect(b.width).toBeGreaterThan(box.width - 60);
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeGreaterThanOrEqual(44);
    }

    // Vercel recovers; the same dialog finishes.
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
    expect(await userExists(user.userId)).toBe(false);
  });
});
