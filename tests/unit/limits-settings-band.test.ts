import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatBandPrice, formatFreePrice } from "@/lib/billing/prices";
import {
  describeBand,
  formatPeriodDate,
  parseBillingRow,
  wantsCardLookup,
  type BillingSummary,
} from "@/lib/settings/band";

vi.mock("server-only", () => ({}));

/**
 * M4-05: what the "Current plan" band says (pure copy rules) and the card lookup behind
 * "Renews Nov 1, 2026 on the card ending 4242." The lookup runs the real Stripe SDK against a tiny
 * local HTTP server that answers like the Stripe API (never the real one): a default card is read,
 * and an error, a deleted customer, an unknown id, a malformed card or a slow answer all read as
 * "no card", so the clause is dropped and the rest of the band still renders.
 */

const PERIOD_END = new Date("2026-11-01T12:00:00Z");

const summary = (patch: Partial<BillingSummary> = {}): BillingSummary => ({
  plan: "pro",
  // Without a gift the effective plan is what the account pays for.
  paidPlan: patch.plan ?? "pro",
  gift: null,
  interval: "month",
  periodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  customerId: "cus_unit",
  subscriptionId: "sub_unit",
  ...patch,
});

describe("M4-05 the band's lines", () => {
  it("M4-05 Free: 'Free', '$0 · free forever' and no renewal line", () => {
    expect(
      describeBand(
        summary({ plan: "free", interval: null, periodEnd: null, subscriptionId: null }),
        null,
      ),
    ).toEqual({ name: "Free", price: `${formatFreePrice()} · free forever`, renewal: null });
    // Even a Free account that once subscribed (it keeps its customer id) has no renewal line.
    expect(describeBand(summary({ plan: "free" }), "4242").renewal).toBeNull();
  });

  it("M4-05 Pro monthly with a period end of 2026-11-01 and a card ending 4242", () => {
    expect(describeBand(summary(), "4242")).toEqual({
      name: "Pro",
      price: formatBandPrice("pro", "month"),
      renewal: "Renews Nov 1, 2026 on the card ending 4242.",
    });
  });

  it("M4-05 the band's price line follows the plan and the interval (from the one price table)", () => {
    expect(describeBand(summary({ interval: "year" }), "4242").price).toBe(
      formatBandPrice("pro", "year"),
    );
    expect(describeBand(summary({ plan: "studio" }), "4242")).toMatchObject({
      name: "Studio",
      price: formatBandPrice("studio", "month"),
    });
    expect(describeBand(summary({ plan: "studio", interval: "year" }), "4242").price).toBe(
      formatBandPrice("studio", "year"),
    );
  });

  it("M4-05 without a card (the lookup failed) the clause is dropped and the rest renders", () => {
    expect(describeBand(summary(), null)).toEqual({
      name: "Pro",
      price: formatBandPrice("pro", "month"),
      renewal: "Renews Nov 1, 2026.",
    });
    // Anything that is not four digits never reaches the page.
    for (const bad of ["", "42", "42424", "abcd", "<b>x</b>"]) {
      expect(describeBand(summary(), bad).renewal, bad).toBe("Renews Nov 1, 2026.");
    }
  });

  it("M4-05 cancel_at_period_end says 'Ends Nov 1, 2026. You keep Pro until then.' with no card clause", () => {
    expect(describeBand(summary({ cancelAtPeriodEnd: true }), "4242").renewal).toBe(
      "Ends Nov 1, 2026. You keep Pro until then.",
    );
    expect(describeBand(summary({ plan: "studio", cancelAtPeriodEnd: true }), "4242").renewal).toBe(
      "Ends Nov 1, 2026. You keep Studio until then.",
    );
  });

  it("M4-05 a paid account with no period end has no renewal line; no interval reads as monthly", () => {
    expect(describeBand(summary({ periodEnd: null }), "4242").renewal).toBeNull();
    expect(describeBand(summary({ interval: null }), null).price).toBe(
      formatBandPrice("pro", "month"),
    );
  });

  it("M4-05 dates are UTC, so the server's time zone never moves the day", () => {
    expect(formatPeriodDate(new Date("2026-11-01T00:00:00Z"))).toBe("Nov 1, 2026");
    expect(formatPeriodDate(new Date("2026-11-01T23:59:59Z"))).toBe("Nov 1, 2026");
  });

  it("M4-05 only a renewing paid subscription with a customer asks Stripe for the card", () => {
    expect(wantsCardLookup(summary())).toBe(true);
    expect(wantsCardLookup(summary({ plan: "free" }))).toBe(false);
    expect(wantsCardLookup(summary({ customerId: null }))).toBe(false);
    expect(wantsCardLookup(summary({ periodEnd: null }))).toBe(false);
    expect(wantsCardLookup(summary({ cancelAtPeriodEnd: true }))).toBe(false);
  });

  it("M4-05 an account row is read defensively: a missing or odd column reads as none", () => {
    expect(parseBillingRow(null)).toMatchObject({
      plan: "free",
      interval: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      customerId: null,
      subscriptionId: null,
    });
    expect(
      parseBillingRow({
        plan: "studio",
        billing_interval: "year",
        current_period_end: "2026-11-01T12:00:00Z",
        cancel_at_period_end: true,
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
      }),
    ).toMatchObject({
      plan: "studio",
      interval: "year",
      cancelAtPeriodEnd: true,
      customerId: "cus_1",
      subscriptionId: "sub_1",
    });
    expect(
      parseBillingRow({ plan: "enterprise", billing_interval: "weekly", current_period_end: "x" }),
    ).toMatchObject({ plan: "free", interval: null, periodEnd: null });
  });
});

// -------------------------------------------------------------------------------------------
// The card lookup against a local stand-in for the Stripe API
// -------------------------------------------------------------------------------------------

interface Seen {
  method: string;
  path: string;
  query: string;
}

describe("M4-05 the card on file (real Stripe SDK, local server)", () => {
  let server: http.Server;
  let lookupCardLast4: typeof import("@/lib/settings/card").lookupCardLast4;
  const seen: Seen[] = [];
  // path -> [status, body] or "hang"
  const routes = new Map<string, [number, unknown] | "hang">();

  const client = () =>
    new Stripe("sk_test_unit_placeholder_not_a_real_key", {
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      protocol: "http",
      maxNetworkRetries: 0,
      timeout: 15_000,
      telemetry: false,
    });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://stub");
      seen.push({
        method: req.method ?? "",
        path: url.pathname,
        query: decodeURIComponent(url.search),
      });
      const route = routes.get(url.pathname);
      if (route === "hang") return; // never answers
      const [status, body] = route ?? [
        404,
        { error: { type: "invalid_request_error", code: "resource_missing", message: "No such" } },
      ];
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    ({ lookupCardLast4 } = await import("@/lib/settings/card"));
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const card = (last4: unknown) => ({ id: "pm_unit", object: "payment_method", card: { last4 } });
  const customer = (id: string, defaultMethod: unknown) => ({
    id,
    object: "customer",
    invoice_settings: { default_payment_method: defaultMethod },
  });

  it("M4-05 reads the customer's default card: 'ending 4242'", async () => {
    seen.length = 0;
    routes.set("/v1/customers/cus_ok", [200, customer("cus_ok", card("4242"))]);
    const last4 = await lookupCardLast4({ customerId: "cus_ok", subscriptionId: "sub_ok" }, client);
    expect(last4).toBe("4242");
    expect(describeBand(summary(), last4).renewal).toBe(
      "Renews Nov 1, 2026 on the card ending 4242.",
    );
    // One read-only request, for the session user's own customer, with the card expanded.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", path: "/v1/customers/cus_ok" });
    expect(seen[0]!.query).toContain("invoice_settings.default_payment_method");
  });

  it("M4-05 falls back to the subscription's default card when the customer has none", async () => {
    routes.set("/v1/customers/cus_nocard", [200, customer("cus_nocard", null)]);
    routes.set("/v1/subscriptions/sub_card", [
      200,
      { id: "sub_card", object: "subscription", default_payment_method: card("1881") },
    ]);
    expect(
      await lookupCardLast4({ customerId: "cus_nocard", subscriptionId: "sub_card" }, client),
    ).toBe("1881");
  });

  it("M4-05 a deleted customer, an unknown id, a 5xx or a malformed card all read as no card", async () => {
    routes.set("/v1/customers/cus_deleted", [
      200,
      { id: "cus_deleted", object: "customer", deleted: true },
    ]);
    expect(
      await lookupCardLast4({ customerId: "cus_deleted", subscriptionId: null }, client),
    ).toBeNull();

    // No route: the server answers 404 resource_missing.
    expect(
      await lookupCardLast4({ customerId: "cus_unknown", subscriptionId: null }, client),
    ).toBeNull();

    routes.set("/v1/customers/cus_boom", [500, { error: { type: "api_error", message: "boom" } }]);
    expect(
      await lookupCardLast4({ customerId: "cus_boom", subscriptionId: null }, client),
    ).toBeNull();

    routes.set("/v1/customers/cus_bad", [200, customer("cus_bad", card("424<"))]);
    expect(
      await lookupCardLast4({ customerId: "cus_bad", subscriptionId: null }, client),
    ).toBeNull();

    // A payment method that came back as a bare id (not expanded) is not a card either.
    routes.set("/v1/customers/cus_id", [200, customer("cus_id", "pm_unexpanded")]);
    expect(
      await lookupCardLast4({ customerId: "cus_id", subscriptionId: null }, client),
    ).toBeNull();

    // Nothing to look up at all.
    seen.length = 0;
    expect(await lookupCardLast4({ customerId: null, subscriptionId: null }, client)).toBeNull();
    expect(seen).toEqual([]);
  });

  it("M4-05 a Stripe that does not answer in a few seconds reads as no card", async () => {
    routes.set("/v1/customers/cus_slow", "hang");
    const started = Date.now();
    const last4 = await lookupCardLast4({ customerId: "cus_slow", subscriptionId: null }, client);
    expect(last4).toBeNull();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(3500);
    expect(elapsed).toBeLessThan(8000);
  });
});
