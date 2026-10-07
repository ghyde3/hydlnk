import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlanBand } from "@/components/settings/plan-band";
import { PlanCards } from "@/components/settings/plan-cards";
import { endedMessage, giftedMessage, parseGiftRow } from "@/lib/billing/gift-view";
import { describeBand, parseBillingRow, wantsCardLookup } from "@/lib/settings/band";

vi.mock("server-only", () => ({}));

/**
 * M13-07: the owner's Settings & billing for a gifted account. The band names the effective plan and
 * the gift ("until Nov 1, 2026" or "no end date"), the cards and buttons keep following what the
 * account pays for (so a real upgrade is still offered), and Manage billing shows only when a Stripe
 * customer exists. Rendered for real; the whole screen runs in tests/e2e/m13/admin-gift-*.spec.ts.
 */

const NOW = new Date("2026-10-06T12:00:00Z");
const row = (patch: Record<string, unknown> = {}) => ({
  plan: "pro",
  paid_plan: "free",
  gift_plan: "pro",
  gift_until: "2026-11-01T23:59:59.999Z",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  billing_interval: null,
  current_period_end: null,
  cancel_at_period_end: false,
  ...patch,
});

describe("M13-07 reading the gift from the account row", () => {
  it("an active gift above the paid plan is the gift; paid plan is read apart from the effective plan", () => {
    const summary = parseBillingRow(row(), NOW);
    expect(summary.plan).toBe("pro");
    expect(summary.paidPlan).toBe("free");
    expect(summary.gift).toEqual({ plan: "pro", until: new Date("2026-11-01T23:59:59.999Z") });
  });

  it("no end date reads as a gift with until null; an ended, absent or lower gift is no gift", () => {
    expect(parseBillingRow(row({ gift_until: null }), NOW).gift).toEqual({
      plan: "pro",
      until: null,
    });
    expect(parseBillingRow(row({ gift_until: "2026-10-01T00:00:00Z" }), NOW).gift).toBeNull();
    expect(
      parseBillingRow(row({ gift_plan: null, gift_until: null, plan: "free" }), NOW).gift,
    ).toBeNull();
    expect(parseBillingRow(row({ paid_plan: "studio", plan: "studio" }), NOW).gift).toBeNull();
  });

  it("a row without paid_plan (an older database) reads the plan as what is paid", () => {
    const summary = parseBillingRow({ plan: "studio" }, NOW);
    expect(summary).toMatchObject({ plan: "studio", paidPlan: "studio", gift: null });
  });
});

describe("M13-07 the band", () => {
  it("says the gift and its end date, names the gifted plan, and shows no charge", () => {
    const text = describeBand(parseBillingRow(row(), NOW), null);
    expect(text).toEqual({
      name: "Pro",
      price: "Gifted · no charge",
      renewal: null,
      gift: "A gift from HYDLNK, until Nov 1, 2026.",
    });
  });

  it("says 'no end date' for an open-ended gift", () => {
    expect(describeBand(parseBillingRow(row({ gift_until: null }), NOW), null).gift).toBe(
      "A gift from HYDLNK, with no end date.",
    );
  });

  it("a paying Pro account under a Studio gift still shows its own renewal and what it pays for", () => {
    const summary = parseBillingRow(
      row({
        plan: "studio",
        paid_plan: "pro",
        gift_plan: "studio",
        stripe_customer_id: "cus_x",
        billing_interval: "month",
        current_period_end: "2026-11-15T00:00:00Z",
      }),
      NOW,
    );
    const text = describeBand(summary, "4242");
    expect(text.name).toBe("Studio");
    expect(text.price).toBe("Gifted · you pay for Pro");
    expect(text.renewal).toBe("Renews Nov 15, 2026 on the card ending 4242.");
    expect(wantsCardLookup(summary)).toBe(true);
  });

  it("a gifted Free account has no card lookup", () => {
    expect(wantsCardLookup(parseBillingRow(row({ stripe_customer_id: "cus_x" }), NOW))).toBe(false);
  });

  it("renders the gift line, and Manage billing only when there is a Stripe customer", () => {
    const render = (patch: Record<string, unknown>) => {
      const summary = parseBillingRow(row(patch), NOW);
      return renderToStaticMarkup(
        createElement(PlanBand, { summary, text: describeBand(summary, null) }),
      );
    };
    const without = render({});
    expect(without).toContain("data-band-gift");
    expect(without).toContain("A gift from HYDLNK, until Nov 1, 2026.");
    expect(without).not.toContain("Manage billing");

    const withCustomer = render({ stripe_customer_id: "cus_x" });
    expect(withCustomer).toContain("Manage billing");
    expect(withCustomer).toContain("data-band-gift");
  });
});

describe("M13-07 the plan cards of a gifted account", () => {
  const html = (gifted: boolean) =>
    renderToStaticMarkup(
      createElement(PlanCards, {
        current: "free",
        gift: gifted ? { plan: "pro", note: "A gift from HYDLNK, until Nov 1, 2026." } : undefined,
      }),
    );

  it("still offers Upgrade to Pro and Upgrade to Studio through Checkout", () => {
    const out = html(true);
    const forms = [...out.matchAll(/<form[^>]*>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(2);
    for (const form of forms) expect(form).toContain('action="/api/billing/checkout"');
    expect(out).toContain("Upgrade to Pro");
    expect(out).toContain("Upgrade to Studio");
  });

  it("puts the gift note on the gifted plan's card and calls the paid card 'Your paid plan'", () => {
    const out = html(true);
    expect(out).toContain("data-gift-note");
    expect(out).toContain("A gift from HYDLNK, until Nov 1, 2026.");
    expect(out).toContain("Your paid plan");
    expect(out).not.toContain(">Current plan<");
  });

  it("an account without a gift is unchanged", () => {
    const out = html(false);
    expect(out).not.toContain("data-gift-note");
    expect(out).toContain("Current plan");
    expect(out).not.toContain("Your paid plan");
  });
});

describe("M13-07 the admin screen's sentences", () => {
  it("gifted and ended outcomes read plainly", () => {
    expect(
      giftedMessage({ plan: "pro", until: "2026-11-01T23:59:59.999Z", effectivePlan: "pro" }),
    ).toBe("Gave Pro until Nov 1, 2026.");
    expect(giftedMessage({ plan: "studio", until: null, effectivePlan: "studio" })).toBe(
      "Gave Studio, no end date.",
    );
    expect(giftedMessage({ plan: "pro", until: null, effectivePlan: "studio" })).toBe(
      "Recorded Pro, no end date, but the account already pays for Studio, so nothing changes yet.",
    );
    expect(endedMessage({ changed: true, effectivePlan: "free" })).toBe(
      "Ended the gift. The account is on Free.",
    );
    expect(endedMessage({ changed: false })).toBe("There was no gift to end.");
  });

  it("parses the account row into the screen's view", () => {
    const view = parseGiftRow(
      {
        id: "a",
        plan: "pro",
        paid_plan: "free",
        gift_plan: "pro",
        gift_until: null,
        gift_reason: "beta tester",
        gifted_at: "2026-10-06T00:00:00Z",
        stripe_customer_id: null,
      },
      { email: "x@example.test", handles: ["x"], giftedByLabel: "admin@example.test" },
    );
    expect(view).toMatchObject({
      plan: "pro",
      paidPlan: "free",
      hasStripeCustomer: false,
      gift: { plan: "pro", until: null, reason: "beta tester", giftedBy: "admin@example.test" },
    });
  });
});
