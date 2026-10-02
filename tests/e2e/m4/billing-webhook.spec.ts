import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, makeUser, rand } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import {
  checkoutCompletedEvent,
  deliver,
  eventId,
  postWebhook,
  priceIds,
  signed,
  subscriptionEvent,
} from "../fixtures/stripe-stub";

/**
 * M4-03 (the webhook accepts only what Stripe signed) and M4-04 (it writes the plan and the
 * subscription state), over HTTP against the dev server and the local database. Pure API specs:
 * they run once, in the desktop project; a user per test, nothing touches mara.
 */

test.afterAll(cleanupUsers);
test.beforeEach(({}, info) => {
  test.skip(!desktopOnly(info), "API only: nothing here depends on the viewport");
});

const COLUMNS =
  "id, plan, stripe_customer_id, stripe_subscription_id, billing_interval, current_period_end, cancel_at_period_end, stripe_event_created_at, suspended_at, updated_at";

async function row(id: string) {
  const { data, error } = await adminClient()
    .from("accounts")
    .select(COLUMNS)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const customerId = () => `cus_zq${rand(10)}`;
const subId = () => `sub_zq${rand(10)}`;

/** A user whose account already has a Stripe customer id, like one that started Checkout. */
async function accountWithCustomer(label: string, plan: "free" | "pro" | "studio" = "free") {
  const user = await makeUser(label, { plan });
  const customer = customerId();
  const { error } = await adminClient()
    .from("accounts")
    .update({ stripe_customer_id: customer })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
  return { ...user, customer };
}

async function eventRecorded(id: string): Promise<boolean> {
  const { data, error } = await adminClient().from("stripe_events").select("id").eq("id", id);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

test.describe("M4-03 signature check", () => {
  test("M4-03 a body signed with the configured secret returns 200 {received:true}", async () => {
    const account = await accountWithCustomer("sig-ok");
    const event = subscriptionEvent({
      customer: account.customer,
      subscriptionId: subId(),
      priceId: priceIds().proMonthly,
    });
    const response = await deliver(event);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: true });
    expect((await row(account.id)).plan).toBe("pro");
  });

  test("M4-03 verification uses the raw body: the same JSON re-serialised fails", async () => {
    const account = await accountWithCustomer("sig-raw");
    const event = subscriptionEvent({
      customer: account.customer,
      subscriptionId: subId(),
      priceId: priceIds().proMonthly,
    });
    const { body, signature } = signed(event);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(reserialised).not.toBe(body);
    const before = JSON.stringify(await row(account.id));
    const response = await postWebhook(reserialised, signature);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await row(account.id))).toBe(before);
  });

  test("M4-03 no signature, another secret, an altered body and an old timestamp are each a 400 that changes nothing", async () => {
    const account = await accountWithCustomer("sig-bad");
    const event = subscriptionEvent({
      customer: account.customer,
      subscriptionId: subId(),
      priceId: priceIds().studioMonthly,
    });
    const before = JSON.stringify(await row(account.id));

    const good = signed(event);
    const wrongSecret = signed(event, { secret: "whsec_not_the_configured_secret" });
    const altered = signed(event);
    const stale = signed(event, { timestamp: Math.floor(Date.now() / 1000) - 6 * 60 });
    const cases: [string, Awaited<ReturnType<typeof postWebhook>>][] = [
      ["no Stripe-Signature header", await postWebhook(good.body, null)],
      ["another secret", await postWebhook(wrongSecret.body, wrongSecret.signature)],
      [
        "a body altered by one character",
        await postWebhook(altered.body.replace(/"active"/, '"activf"'), altered.signature),
      ],
      ["a timestamp older than 5 minutes", await postWebhook(stale.body, stale.signature)],
      ["a malformed header", await postWebhook(good.body, "t=1,v1=zz")],
      ["an empty body", await postWebhook("", good.signature)],
    ];
    for (const [label, response] of cases) {
      expect(response.status, label).toBe(400);
      expect(response.body, label).not.toContain(account.customer);
    }
    expect(JSON.stringify(await row(account.id))).toBe(before);
    expect(await eventRecorded(event.id)).toBe(false);

    // The timestamp edge: a signature minted 4 minutes ago is still inside the tolerance.
    const fresh = signed(event, { timestamp: Math.floor(Date.now() / 1000) - 4 * 60 });
    expect((await postWebhook(fresh.body, fresh.signature)).status).toBe(200);
  });

  test("M4-03 a signed event the handler does not handle returns 200 and writes nothing", async () => {
    const account = await accountWithCustomer("sig-other");
    const before = JSON.stringify(await row(account.id));
    const id = eventId();
    const response = await deliver({
      id,
      object: "event",
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "in_zq1", customer: account.customer } },
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: true });
    expect(JSON.stringify(await row(account.id))).toBe(before);
    expect(await eventRecorded(id)).toBe(false);
  });

  test("M4-03 GET, PUT and DELETE on the route return 405", async () => {
    const { body, signature } = signed({ id: eventId(), type: "invoice.paid" });
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await postWebhook(body, signature, "app.localhost:3000", method);
      expect(response.status, method).toBe(405);
    }
  });

  test("M4-03 abuse: an unsigned event moving a customer to Studio is a 400 and the plan stays", async () => {
    const account = await accountWithCustomer("sig-abuse");
    const event = subscriptionEvent({
      customer: account.customer,
      subscriptionId: subId(),
      priceId: priceIds().studioMonthly,
    });
    const response = await postWebhook(JSON.stringify(event), null);
    expect(response.status).toBe(400);
    expect((await row(account.id)).plan).toBe("free");
  });

  test("M4-03 the route exists only on the app host: other hosts get 404 before the signature is looked at", async () => {
    // Each host compiles its own 404 route on a cold dev server.
    test.setTimeout(240_000);
    const account = await accountWithCustomer("sig-host");
    const event = subscriptionEvent({
      customer: account.customer,
      subscriptionId: subId(),
      priceId: priceIds().proMonthly,
    });
    const { body, signature } = signed(event);
    const before = JSON.stringify(await row(account.id));
    for (const host of ["mara.localhost:3000", "localhost:3000", "links.example.test"]) {
      const validlySigned = await postWebhook(body, signature, host);
      expect(validlySigned.status, `${host} signed`).toBe(404);
      // A forged signature gets the same 404, not a 400: the signature is never evaluated.
      const forged = await postWebhook(body, "t=1,v1=00", host);
      expect(forged.status, `${host} forged`).toBe(404);
    }
    expect(JSON.stringify(await row(account.id))).toBe(before);
  });
});

test.describe("M4-04 plan and subscription state", () => {
  const TABLE = [
    { price: "proMonthly", plan: "pro", interval: "month" },
    { price: "proYearly", plan: "pro", interval: "year" },
    { price: "studioMonthly", plan: "studio", interval: "month" },
    { price: "studioYearly", plan: "studio", interval: "year" },
  ] as const;

  for (const { price, plan, interval } of TABLE) {
    for (const type of [
      "customer.subscription.created",
      "customer.subscription.updated",
    ] as const) {
      test(`M4-04 ${type} on the ${plan} ${interval}ly price sets plan, interval, period end and cancel flag`, async () => {
        const account = await accountWithCustomer(`tbl-${plan}`);
        const subscription = subId();
        const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86400;
        const response = await deliver(
          subscriptionEvent({
            type,
            customer: account.customer,
            subscriptionId: subscription,
            priceId: priceIds()[price],
            periodEnd,
            cancelAtPeriodEnd: true,
          }),
        );
        expect(response.status).toBe(200);
        const after = await row(account.id);
        expect(after.plan).toBe(plan);
        expect(after.billing_interval).toBe(interval);
        expect(after.stripe_subscription_id).toBe(subscription);
        expect(after.cancel_at_period_end).toBe(true);
        expect(new Date(after.current_period_end as string).getTime()).toBe(periodEnd * 1000);
        expect(after.stripe_customer_id).toBe(account.customer);
      });
    }
  }

  test("M4-04 active, trialing and past_due grant the plan; the other statuses mean Free", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const account = await accountWithCustomer(`st-${status}`);
      await deliver(
        subscriptionEvent({
          customer: account.customer,
          subscriptionId: subId(),
          status,
          priceId: priceIds().proMonthly,
        }),
      );
      expect((await row(account.id)).plan, status).toBe("pro");
    }
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      const account = await accountWithCustomer(`st-${status}`, "studio");
      const subscription = subId();
      const t0 = Math.floor(Date.now() / 1000) - 100;
      await deliver(
        subscriptionEvent({
          created: t0,
          customer: account.customer,
          subscriptionId: subscription,
          priceId: priceIds().studioYearly,
        }),
      );
      expect((await row(account.id)).plan, `${status}: before`).toBe("studio");
      const response = await deliver(
        subscriptionEvent({
          created: t0 + 10,
          customer: account.customer,
          subscriptionId: subscription,
          status,
          priceId: priceIds().studioYearly,
        }),
      );
      expect(response.status).toBe(200);
      const after = await row(account.id);
      expect(after.plan, status).toBe("free");
      expect(after.stripe_subscription_id, status).toBeNull();
    }
  });

  test("M4-04 customer.subscription.deleted sets Free, clears the subscription columns and keeps the customer id", async () => {
    const account = await accountWithCustomer("del");
    const subscription = subId();
    const t0 = Math.floor(Date.now() / 1000) - 100;
    await deliver(
      subscriptionEvent({
        created: t0,
        customer: account.customer,
        subscriptionId: subscription,
        priceId: priceIds().proYearly,
        cancelAtPeriodEnd: true,
      }),
    );
    const response = await deliver(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        created: t0 + 10,
        customer: account.customer,
        subscriptionId: subscription,
        status: "canceled",
        priceId: priceIds().proYearly,
      }),
    );
    expect(response.status).toBe(200);
    const after = await row(account.id);
    expect(after).toMatchObject({
      plan: "free",
      stripe_subscription_id: null,
      billing_interval: null,
      current_period_end: null,
      cancel_at_period_end: false,
      stripe_customer_id: account.customer,
    });
  });

  test("M4-04 checkout.session.completed saves the customer id when null and never sets the plan", async () => {
    const user = await makeUser("co");
    const customer = customerId();
    const response = await deliver(checkoutCompletedEvent({ customer, accountId: user.id }));
    expect(response.status).toBe(200);
    expect(await row(user.id)).toMatchObject({ stripe_customer_id: customer, plan: "free" });

    // An account that already has a customer keeps it.
    await deliver(checkoutCompletedEvent({ customer: customerId(), accountId: user.id }));
    expect((await row(user.id)).stripe_customer_id).toBe(customer);

    // A payment-mode session is not ours to act on.
    const other = await makeUser("co-pay");
    await deliver(
      checkoutCompletedEvent({ customer: customerId(), accountId: other.id, mode: "payment" }),
    );
    expect((await row(other.id)).stripe_customer_id).toBeNull();
  });

  test("M4-04 the account is found by customer id, then by metadata.account_id; an unknown customer writes nothing", async () => {
    // By metadata: the account has no customer id yet.
    const user = await makeUser("meta");
    const customer = customerId();
    const response = await deliver(
      subscriptionEvent({
        customer,
        subscriptionId: subId(),
        priceId: priceIds().proMonthly,
        accountId: user.id,
      }),
    );
    expect(response.status).toBe(200);
    expect(await row(user.id)).toMatchObject({ plan: "pro", stripe_customer_id: customer });

    // By metadata, but the account belongs to another customer: not this event's account.
    const taken = await accountWithCustomer("meta-taken");
    const before = JSON.stringify(await row(taken.id));
    const mismatch = await deliver(
      subscriptionEvent({
        customer: customerId(),
        subscriptionId: subId(),
        priceId: priceIds().studioMonthly,
        accountId: taken.id,
      }),
    );
    expect(mismatch.status).toBe(200);
    expect(JSON.stringify(await row(taken.id))).toBe(before);

    // Unknown customer, no metadata, and metadata for an account that does not exist.
    const bystander = await accountWithCustomer("meta-by");
    const bystanderBefore = JSON.stringify(await row(bystander.id));
    for (const accountId of [undefined, "00000000-0000-4000-8000-00000000dead", "not-a-uuid"]) {
      const unknown = await deliver(
        subscriptionEvent({
          customer: customerId(),
          subscriptionId: subId(),
          priceId: priceIds().studioMonthly,
          accountId,
        }),
      );
      expect(unknown.status, String(accountId)).toBe(200);
      expect(JSON.parse(unknown.body)).toEqual({ received: true });
    }
    expect(JSON.stringify(await row(bystander.id))).toBe(bystanderBefore);
  });

  test("M4-04 an unknown price id is a 200 that changes nothing", async () => {
    const account = await accountWithCustomer("price-x", "pro");
    const subscription = subId();
    await deliver(
      subscriptionEvent({
        created: Math.floor(Date.now() / 1000) - 50,
        customer: account.customer,
        subscriptionId: subscription,
        priceId: priceIds().proMonthly,
      }),
    );
    const before = JSON.stringify(await row(account.id));
    const id = eventId();
    const response = await deliver(
      subscriptionEvent({
        id,
        customer: account.customer,
        subscriptionId: subscription,
        priceId: "price_zq_not_ours",
      }),
    );
    expect(response.status).toBe(200);
    expect(JSON.stringify(await row(account.id))).toBe(before);
    expect(await eventRecorded(id)).toBe(false);
  });

  test("M4-04 delivering the same signed event twice leaves the row identical", async () => {
    const account = await accountWithCustomer("idem");
    const event = subscriptionEvent({
      customer: account.customer,
      subscriptionId: subId(),
      priceId: priceIds().studioYearly,
    });
    const { body, signature } = signed(event);
    expect((await postWebhook(body, signature)).status).toBe(200);
    const once = JSON.stringify(await row(account.id));
    expect(JSON.parse(once).plan).toBe("studio");
    const replay = await postWebhook(body, signature);
    expect(replay.status).toBe(200);
    expect(JSON.parse(replay.body)).toEqual({ received: true });
    expect(JSON.stringify(await row(account.id))).toBe(once);
    const { data } = await adminClient().from("stripe_events").select("id").eq("id", event.id);
    expect(data).toHaveLength(1);

    // Five at once end in the same state.
    const burst = signed(
      subscriptionEvent({
        customer: account.customer,
        subscriptionId: JSON.parse(once).stripe_subscription_id,
        priceId: priceIds().proMonthly,
        created: event.created + 5,
      }),
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postWebhook(burst.body, burst.signature)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await row(account.id)).toMatchObject({ plan: "pro", billing_interval: "month" });
  });

  test("M4-04 order-safe: a delete (created 200) then an update (created 100) leaves the account on Free", async () => {
    const account = await accountWithCustomer("order");
    const subscription = subId();
    const common = { customer: account.customer, subscriptionId: subscription };
    await deliver(subscriptionEvent({ ...common, created: 50, priceId: priceIds().proMonthly }));
    expect((await row(account.id)).plan).toBe("pro");
    await deliver(
      subscriptionEvent({
        ...common,
        type: "customer.subscription.deleted",
        created: 200,
        status: "canceled",
        priceId: priceIds().proMonthly,
      }),
    );
    const late = await deliver(
      subscriptionEvent({ ...common, created: 100, priceId: priceIds().proMonthly }),
    );
    expect(late.status).toBe(200);
    expect(await row(account.id)).toMatchObject({ plan: "free", stripe_subscription_id: null });
  });

  test("M4-04 a cancel for an older subscription does not take away the current one", async () => {
    const account = await accountWithCustomer("two-subs");
    const current = subId();
    await deliver(
      subscriptionEvent({
        created: 300,
        customer: account.customer,
        subscriptionId: current,
        priceId: priceIds().proYearly,
      }),
    );
    await deliver(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        created: 400,
        customer: account.customer,
        subscriptionId: subId(),
        status: "canceled",
        priceId: priceIds().proMonthly,
      }),
    );
    expect(await row(account.id)).toMatchObject({ plan: "pro", stripe_subscription_id: current });
  });

  test("M4-04 events for a deleted account are acknowledged and write nothing", async () => {
    const account = await accountWithCustomer("gone");
    await adminClient().auth.admin.deleteUser(account.id);
    const response = await deliver(
      subscriptionEvent({
        customer: account.customer,
        subscriptionId: subId(),
        priceId: priceIds().studioMonthly,
        accountId: account.id,
      }),
    );
    expect(response.status).toBe(200);
    const { data } = await adminClient().from("accounts").select("id").eq("id", account.id);
    expect(data).toEqual([]);
  });

  test("M4-04 abuse: a user's own JWT and the publishable key cannot write any account column", async () => {
    const user = await makeUser("rest");
    const other = await makeUser("rest-other", { plan: "studio" });
    const token = await accessTokenFor(user.email);
    const before = JSON.stringify(await row(user.id));

    const attempts: Record<string, unknown>[] = [
      { plan: "studio" },
      { stripe_customer_id: "cus_mine" },
      { suspended_at: null },
      { stripe_subscription_id: "sub_mine" },
      { billing_interval: "year" },
      { current_period_end: "2030-01-01T00:00:00Z" },
      { cancel_at_period_end: true },
      { stripe_event_created_at: "2000-01-01T00:00:00Z" },
    ];
    for (const body of attempts) {
      const patched = await restAs(token, `/accounts?id=eq.${user.id}`, { method: "PATCH", body });
      const rows = Array.isArray(patched.body) ? patched.body : [];
      expect(rows, JSON.stringify(body)).toEqual([]);
      expect([401, 403, 200, 204]).toContain(patched.status);
    }
    const stolen = await restAs(token, `/accounts?id=eq.${other.id}`, {
      method: "PATCH",
      body: { plan: "free" },
    });
    expect(Array.isArray(stolen.body) ? stolen.body : []).toEqual([]);
    expect(JSON.stringify(await row(user.id))).toBe(before);
    expect((await row(other.id)).plan).toBe("studio");

    // Reading: the owner sees their own row (the new columns included) and nobody else's.
    const own = await restAs(
      token,
      `/accounts?id=eq.${user.id}&select=plan,stripe_subscription_id,billing_interval,current_period_end,cancel_at_period_end`,
    );
    expect(own.status).toBe(200);
    expect(own.body).toEqual([
      {
        plan: "free",
        stripe_subscription_id: null,
        billing_interval: null,
        current_period_end: null,
        cancel_at_period_end: false,
      },
    ]);
    const theirs = await restAs(token, `/accounts?id=eq.${other.id}&select=plan`);
    expect(theirs.body).toEqual([]);

    // The RPC and the events table are not reachable with a user's token either.
    const rpc = await restAs(token, "/rpc/apply_subscription_state", {
      method: "POST",
      body: {
        p_account_id: user.id,
        p_event_created: new Date().toISOString(),
        p_subscription_id: "sub_x",
        p_plan: "studio",
        p_interval: "month",
        p_period_end: null,
        p_cancel_at_period_end: false,
      },
    });
    expect(rpc.status).toBeGreaterThanOrEqual(400);
    expect((await row(user.id)).plan).toBe("free");
    const events = await restAs(token, "/stripe_events");
    expect(events.status).toBeGreaterThanOrEqual(400);
  });
});
