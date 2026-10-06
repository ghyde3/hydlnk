import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanCards } from "@/components/settings/plan-cards";
import { formatCardPrice } from "@/lib/billing/prices";

/**
 * The Upgrade buttons on the Plans card. They are offered to a Free account only, and not while
 * paid plans are closed (PAID_PLANS_OPEN=false: "Paid plans open soon") nor while an upgrade is
 * being confirmed after Checkout ("Upgrade pending"). The cards and their prices always stay.
 * Rendered for real; the server page decides the two flags (tests/e2e/m4/billing-plans-closed.spec.ts
 * runs that against a server with PAID_PLANS_OPEN=false).
 */

type Props = Parameters<typeof PlanCards>[0];
const html = (props: Props) => renderToStaticMarkup(createElement(PlanCards, props));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("Free account, plans open", () => {
  const out = html({ current: "free" });

  it("offers Upgrade to Pro and Upgrade to Studio as forms that POST to the Checkout endpoint", () => {
    const forms = [...out.matchAll(/<form[^>]*>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form).toContain('method="post"');
      expect(form).toContain('action="/api/billing/checkout"');
    }
    expect(out).toContain("Upgrade to Pro");
    expect(out).toContain("Upgrade to Studio");
    expect(out).not.toContain("data-unavailable");
    expect(out).not.toContain("Paid plans open soon");
    expect(out).not.toContain("Upgrade pending");
  });

  it("defaults paidPlansOpen to true and confirming to false", () => {
    expect(html({ current: "free", paidPlansOpen: true, confirming: false })).toBe(out);
  });
});

describe("paid plans closed", () => {
  const out = html({ current: "free", paidPlansOpen: false });

  it("renders two disabled buttons that read 'Paid plans open soon' and no checkout form at all", () => {
    expect(count(out, 'data-unavailable="closed"')).toBe(2);
    expect(count(out, "Paid plans open soon")).toBe(2);
    expect(out).not.toContain("<form");
    expect(out).not.toContain("/api/billing/checkout");
    expect(out).not.toContain("Upgrade to Pro");
    expect(out).not.toContain("Upgrade to Studio");
    const buttons = [...out.matchAll(/<button[^>]*data-unavailable="closed"[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain("disabled");
      expect(button).toContain('aria-disabled="true"');
      expect(button).toContain('type="button"');
      expect(button).toContain("min-h-11");
    }
  });

  it("keeps all three plan cards and their prices", () => {
    expect(count(out, "data-plan-card=")).toBe(3);
    for (const [plan, price] of [
      ["free", formatCardPrice("free", "month")],
      ["pro", formatCardPrice("pro", "month")],
      ["studio", formatCardPrice("studio", "month")],
    ] as const) {
      expect(out, plan).toContain(`>${price}</span>`);
    }
    expect(out).toContain("Plans");
  });

  it("keeps the Monthly | Yearly control (prices stay visible and switchable)", () => {
    expect(out).toContain("Monthly");
    expect(out).toContain("Yearly");
  });

  it("closed wins over confirming", () => {
    const both = html({ current: "free", paidPlansOpen: false, confirming: true });
    expect(count(both, "Paid plans open soon")).toBe(2);
    expect(both).not.toContain("Upgrade pending");
  });
});

describe("an upgrade is being confirmed", () => {
  const out = html({ current: "free", confirming: true });

  it("does not offer Upgrade: two disabled 'Upgrade pending' buttons, no form, prices still shown", () => {
    expect(count(out, 'data-unavailable="pending"')).toBe(2);
    expect(count(out, "Upgrade pending")).toBe(2);
    expect(out).not.toContain("<form");
    expect(out).not.toContain("Upgrade to Pro");
    expect(out).not.toContain("Upgrade to Studio");
    expect(out).toContain(`>${formatCardPrice("pro", "month")}</span>`);
  });
});

describe("accounts that are not Free are not affected by either flag", () => {
  for (const current of ["pro", "studio"] as const) {
    it(`${current}: the same buttons (portal forms) whatever the flags say`, () => {
      const open = html({ current });
      for (const flags of [{ paidPlansOpen: false }, { confirming: true }]) {
        expect(html({ current, ...flags })).toBe(open);
      }
      expect(open).not.toContain("Paid plans open soon");
      expect(open).not.toContain("/api/billing/checkout");
    });
  }
});
