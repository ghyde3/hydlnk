import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, rand } from "../fixtures/data";
import {
  checkoutCompletedEvent,
  deliver,
  priceIds,
  stubCalls,
  subscriptionEvent,
} from "../fixtures/stripe-stub";
import { giftRow } from "./admin-gift-helpers";

/**
 * M13-07: the Stripe webhook with and without a gift, over HTTP against the dev server, the local
 * database and the Stripe stub. The webhook writes `paid_plan`; the database derives the plan, so a
 * subscription change or cancellation keeps an active gift and ending the gift returns the account
 * to what it pays for. A gift itself never calls Stripe (no stub request for the account's customer).
 * API only, so it runs once (desktop project); a user per test.
 */

test.afterAll(cleanupUsers);
test.beforeEach(({}, info) => {
  test.skip(!desktopOnly(info), "API only: nothing here depends on the viewport");
});

const ADMIN_ID = "11111111-2222-4333-8444-555555555555";

async function account(label: string) {
  const user = await makeUser(label);
  const customer = `cus_zqg${rand(10)}`;
  const { error } = await adminClient()
    .from("accounts")
    .update({ stripe_customer_id: customer })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
  return { ...user, customer, subscription: `sub_zqg${rand(10)}` };
}

const gift = async (id: string, plan: "pro" | "studio") => {
  const { data, error } = await adminClient().rpc("admin_set_gift", {
    p_account: id,
    p_plan: plan,
    p_until: null,
    p_reason: "e2e",
    p_admin: ADMIN_ID,
  });
  if (error) throw new Error(error.message);
  return data;
};

test("M13-07 without a gift the webhook still sets paid_plan and plan together", async () => {
  const a = await account("gwh-none");
  const t0 = Math.floor(Date.now() / 1000) - 100;
  await deliver(
    subscriptionEvent({
      created: t0,
      customer: a.customer,
      subscriptionId: a.subscription,
      priceId: priceIds().proMonthly,
    }),
  );
  expect(await giftRow(a.id)).toMatchObject({ plan: "pro", paid_plan: "pro", gift_plan: null });
});

test("M13-07 a subscription change and a cancellation keep an active gift; ending it returns to the paid plan; a gift never calls Stripe", async () => {
  const a = await account("gwh-gift");
  expect(await gift(a.id, "studio")).toBe("ok");
  expect(await giftRow(a.id)).toMatchObject({ plan: "studio", paid_plan: "free" });
  // Giving a plan made no request to Stripe for this customer.
  expect(await stubCalls("POST", /./, a.customer)).toEqual([]);
  expect(await stubCalls("GET", /./, a.customer)).toEqual([]);

  const t0 = Math.floor(Date.now() / 1000) - 100;
  // Subscribes to Pro: paid Pro, still Studio.
  await deliver(
    subscriptionEvent({
      type: "customer.subscription.created",
      created: t0,
      customer: a.customer,
      subscriptionId: a.subscription,
      priceId: priceIds().proMonthly,
    }),
  );
  expect(await giftRow(a.id)).toMatchObject({
    plan: "studio",
    paid_plan: "pro",
    gift_plan: "studio",
  });

  // Cancels: paid Free, the gift holds.
  const canceled = await deliver(
    subscriptionEvent({
      type: "customer.subscription.deleted",
      created: t0 + 10,
      customer: a.customer,
      subscriptionId: a.subscription,
      status: "canceled",
      priceId: priceIds().proMonthly,
    }),
  );
  expect(canceled.status).toBe(200);
  expect(await giftRow(a.id)).toMatchObject({
    plan: "studio",
    paid_plan: "free",
    gift_plan: "studio",
  });

  // Subscribes to Pro again (a new subscription), then the gift ends: Pro, not Free.
  const second = `sub_zqg${rand(10)}`;
  await deliver(
    subscriptionEvent({
      type: "customer.subscription.created",
      created: t0 + 20,
      customer: a.customer,
      subscriptionId: second,
      priceId: priceIds().proMonthly,
    }),
  );
  expect(await giftRow(a.id)).toMatchObject({ plan: "studio", paid_plan: "pro" });
  const ended = await adminClient().rpc("admin_end_gift", { p_account: a.id });
  expect(ended.data).toBe("ended");
  expect(await giftRow(a.id)).toMatchObject({ plan: "pro", paid_plan: "pro", gift_plan: null });
});

test("M13-07 a completed Checkout under a gift saves the customer and never sets the plan", async () => {
  const user = await makeUser("gwh-checkout");
  expect(await gift(user.id, "pro")).toBe("ok");
  const customer = `cus_zqg${rand(10)}`;
  const response = await deliver(checkoutCompletedEvent({ customer, accountId: user.id }));
  expect(response.status).toBe(200);
  expect(await giftRow(user.id)).toMatchObject({
    plan: "pro",
    paid_plan: "free",
    gift_plan: "pro",
    stripe_customer_id: customer,
  });
});
