// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * M5-19: the billing states. The meter levels (90% and 100%), the sentence a failed billing button
 * sends the browser back with (never a word from Stripe), and the support line on the Checkout
 * return that takes longer than usual.
 */

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ALMOST_FULL_TEXT, fullText, meterLevel, meterStateText } =
  await import("@/components/settings/meter-state");
const { UsageCard } = await import("@/components/settings/usage-card");
const { buildMeters } = await import("@/lib/limits");
const { BILLING_MESSAGES, billingMessage } = await import("@/lib/billing/prices");
const { answer, navigationCode } = await import("@/lib/billing/http");
const { CheckoutReturnNotice } = await import("@/components/billing/checkout-return");
const { CHECKOUT_SLOW } = await import("@/lib/billing/return");

const MIB = 1024 * 1024;
const usage = (
  overrides: Partial<{
    pages: number;
    domains: number;
    savedThemes: number;
    uploadBytes: number;
  }> = {},
) => ({
  pages: 0,
  domains: 0,
  savedThemes: 0,
  uploadBytes: 0,
  ...overrides,
});

describe("M5-19 meterLevel", () => {
  it("is ok below 90%, almost from 90% up to 100%, full at 100% and past it", () => {
    const at = (percent: number, over = false) => meterLevel({ dashed: false, percent, over });
    expect(at(0)).toBe("ok");
    expect(at(89.99)).toBe("ok");
    expect(at(90)).toBe("almost");
    expect(at(99.99)).toBe("almost");
    expect(at(100)).toBe("full");
    expect(at(100, true)).toBe("full");
  });

  it("a meter with no limit or a plan that does not include it (dashed) has no level", () => {
    expect(meterLevel({ dashed: true, percent: 100, over: false })).toBe("ok");
    const free = buildMeters("free", usage({ domains: 0 }));
    expect(free.find((m) => m.key === "domains")!.dashed).toBe(true);
    expect(
      meterStateText(
        free.find((m) => m.key === "domains")!,
        "free",
      ),
    ).toBeNull();
    const studio = buildMeters("studio", usage({ savedThemes: 40 }));
    expect(studio.find((m) => m.key === "themes")!.dashed).toBe(true);
    expect(
      meterStateText(
        studio.find((m) => m.key === "themes")!,
        "studio",
      ),
    ).toBeNull();
  });
});

describe("M5-19 meterStateText on the real meters", () => {
  const uploads = (plan: "free" | "pro" | "studio", bytes: number) =>
    buildMeters(plan, usage({ uploadBytes: bytes })).find((m) => m.key === "uploads")!;

  it("Free uploads: 8 of 10 MB says nothing, 9 reads Almost full, 10 reads the full sentence", () => {
    expect(meterStateText(uploads("free", 8 * MIB), "free")).toBeNull();
    expect(meterStateText(uploads("free", 9 * MIB), "free")).toBe("Almost full");
    expect(ALMOST_FULL_TEXT).toBe("Almost full");
    expect(meterStateText(uploads("free", 10 * MIB), "free")).toBe(
      "Full. Remove an image or upgrade.",
    );
  });

  it("exactly 90% is almost; one byte under is not", () => {
    expect(meterStateText(uploads("free", 9 * MIB), "free")).toBe("Almost full");
    expect(meterStateText(uploads("free", 9 * MIB - 1), "free")).toBeNull();
  });

  it("a meter already over its limit keeps the over-limit note and gets no second sentence", () => {
    const over = uploads("free", 12 * MIB);
    expect(over.over).toBe(true);
    expect(meterLevel(over)).toBe("full");
    expect(meterStateText(over, "free")).toBeNull();
  });

  it("the sentence follows what the meter counts, and Studio has nothing to upgrade to", () => {
    expect(fullText("uploads", "free")).toBe("Full. Remove an image or upgrade.");
    expect(fullText("pages", "free")).toBe("Full. Upgrade for more sites.");
    expect(fullText("domains", "pro")).toBe("Full. Upgrade for more domains.");
    expect(fullText("themes", "free")).toBe("Full. Delete a theme or upgrade.");
    expect(fullText("uploads", "studio")).toBe("Full. Remove an image.");
    expect(fullText("pages", "studio")).toBe("Full.");
    for (const plan of ["free", "pro", "studio"] as const) {
      for (const key of ["uploads", "pages", "domains", "themes"] as const) {
        const text = fullText(key, plan);
        expect(text).not.toMatch(/please|!|successfully/i);
        expect(text.startsWith("Full.")).toBe(true);
      }
    }
  });
});

describe("M5-19 the usage card", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("brass fill below 90%, --hl-bad from 90%, with the sentence under it", () => {
    for (const [bytes, level, fillClass, text] of [
      [5 * MIB, "ok", "bg-brass", null],
      [9 * MIB, "almost", "bg-bad", "Almost full"],
      [10 * MIB, "full", "bg-bad", "Full. Remove an image or upgrade."],
    ] as const) {
      act(() =>
        root.render(
          createElement(UsageCard, {
            meters: buildMeters("free", usage({ uploadBytes: bytes })),
            plan: "free",
          }),
        ),
      );
      const meter = host.querySelector('[data-meter="uploads"]')!;
      expect(meter.getAttribute("data-meter-level"), String(bytes)).toBe(level);
      expect(meter.querySelector("[data-meter-fill]")!.className).toContain(fillClass);
      expect(meter.querySelector("[data-meter-fill]")!.className).not.toContain(
        fillClass === "bg-brass" ? "bg-bad" : "bg-brass",
      );
      expect(meter.querySelector("[data-meter-state]")?.textContent ?? null).toBe(text);
    }
  });

  it("the old over-limit note is unchanged (and is not the new state line)", () => {
    act(() =>
      root.render(
        createElement(UsageCard, {
          meters: buildMeters("free", usage({ uploadBytes: 12 * MIB })),
          plan: "free",
        }),
      ),
    );
    const meter = host.querySelector('[data-meter="uploads"]')!;
    expect(meter.querySelector("[data-meter-note]")!.textContent).toBe(
      "Over your plan’s limit. What you have stays; you can’t add more.",
    );
    expect(meter.querySelector("[data-meter-state]")).toBeNull();
    expect(meter.querySelector("[data-meter-fill]")!.className).toContain("bg-bad");
  });

  it("a dashed meter has no fill and no level", () => {
    act(() =>
      root.render(createElement(UsageCard, { meters: buildMeters("free", usage()), plan: "free" })),
    );
    const domains = host.querySelector('[data-meter="domains"]')!;
    expect(domains.querySelector("[data-meter-fill]")).toBeNull();
    expect(domains.hasAttribute("data-meter-level")).toBe(false);
  });
});

describe("M5-19 a billing form that failed", () => {
  it("a Stripe failure becomes the code of the button that was pressed; every other code is unchanged", () => {
    expect(navigationCode("stripe_unavailable", "checkout")).toBe("checkout_failed");
    expect(navigationCode("stripe_unavailable", "portal")).toBe("portal_failed");
    expect(navigationCode("stripe_unavailable")).toBe("stripe_unavailable");
    for (const code of [
      "plans_closed",
      "already_subscribed",
      "no_customer",
      "checkout_in_progress",
    ]) {
      expect(navigationCode(code, "checkout")).toBe(code);
      expect(navigationCode(code, "portal")).toBe(code);
    }
  });

  it("the two sentences, with no Stripe in them", () => {
    expect(billingMessage("checkout_failed")).toBe("We couldn’t start checkout. Try again.");
    expect(billingMessage("portal_failed")).toBe("We couldn’t open billing. Try again.");
    expect(billingMessage("checkout_in_progress")).toBe(
      "Another checkout was just started. Try again in a moment.",
    );
    for (const code of ["checkout_failed", "portal_failed", "checkout_in_progress"]) {
      expect(BILLING_MESSAGES[code], code).not.toMatch(/stripe|please|!|successfully/i);
    }
  });

  const request = (headers: Record<string, string>) =>
    new NextRequest("http://app.localhost:3000/api/billing/checkout", { method: "POST", headers });

  it("answer(): a browser form goes back to Settings with the button's code; a JSON client keeps stripe_unavailable", async () => {
    const failure = { ok: false, status: 502, error: "stripe_unavailable" } as const;
    const form = answer(request({ "sec-fetch-mode": "navigate" }), failure, "checkout");
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe(
      "http://app.localhost:3000/settings?billing_error=checkout_failed",
    );
    const portal = answer(request({ "sec-fetch-mode": "navigate" }), failure, "portal");
    expect(portal.headers.get("location")).toBe(
      "http://app.localhost:3000/settings?billing_error=portal_failed",
    );
    const api = answer(request({}), failure, "checkout");
    expect(api.status).toBe(502);
    expect(await api.json()).toEqual({ error: "stripe_unavailable" });
  });
});

describe("M5-19 the Checkout return that takes longer than usual", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    search = "?checkout=success";
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const mount = (supportEmail?: string) =>
    act(() => root.render(createElement(CheckoutReturnNotice, { plan: "free", supportEmail })));
  const slow = () => act(() => void vi.advanceTimersByTime(31_000));

  it("with the support address: the sentence, then 'If it persists, contact {SUPPORT_EMAIL}.' with a mailto link", () => {
    mount("help@example.test");
    slow();
    const box = host.querySelector("[data-billing-notice]")!;
    expect(box.getAttribute("data-billing-notice")).toBe("slow");
    expect(box.textContent).toBe(`${CHECKOUT_SLOW} If it persists, contact help@example.test.`);
    const link = box.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("mailto:help@example.test");
    expect(link.textContent).toBe("help@example.test");
  });

  it("without an address nothing is added (the M4 sentence stands alone)", () => {
    mount();
    slow();
    expect(host.querySelector("[data-billing-notice]")!.textContent).toBe(CHECKOUT_SLOW);
  });

  it("the support line is only part of the slow message, not of 'Confirming your upgrade'", () => {
    mount("help@example.test");
    expect(host.querySelector("[data-billing-notice]")!.textContent).not.toContain(
      "help@example.test",
    );
  });
});
