// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-06 return handling: what Settings shows after Stripe sends the browser back. The component is
 * rendered for real in jsdom with only the Next router mocked; the timing (every 2 seconds, for 30)
 * runs on fake timers. The notice never decides the plan: `plan` is what the server read.
 */

const refresh = vi.fn();
const replace = vi.fn();
const router = { refresh, replace };
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const { CheckoutReturnNotice } = await import("@/components/billing/checkout-return");
const {
  CHECKOUT_CANCELED,
  CHECKOUT_CONFIRMING,
  CHECKOUT_SLOW,
  parseCheckoutReturn,
} = await import("@/lib/billing/return");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const mount = (plan: string) => {
  act(() => root.render(createElement(CheckoutReturnNotice, { plan })));
};
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const notice = () => container.querySelector("[data-billing-notice]");

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  search = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("M4-06 checkout=success while the plan is still Free", () => {
  it("says 'Confirming your upgrade' in a polite live region", () => {
    search = "?checkout=success";
    mount("free");
    const box = notice()!;
    expect(box.textContent).toContain(CHECKOUT_CONFIRMING);
    expect(box.getAttribute("aria-live")).toBe("polite");
    expect(box.getAttribute("role")).toBe("status");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("re-reads the account every 2 seconds", () => {
    search = "?checkout=success";
    mount("free");
    advance(1_999);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(8_000);
    expect(refresh).toHaveBeenCalledTimes(5);
    expect(notice()!.textContent).toContain(CHECKOUT_CONFIRMING);
  });

  it("after 30 seconds without a flip says so, and stops asking", () => {
    search = "?checkout=success";
    mount("free");
    advance(30_000);
    expect(notice()!.textContent).toBe(CHECKOUT_SLOW);
    expect(CHECKOUT_SLOW).toBe(
      "This is taking longer than usual. Refresh in a minute. You are only charged once.",
    );
    const calls = refresh.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(15);
    expect(calls).toBeGreaterThanOrEqual(14);
    advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(calls);
    expect(replace).not.toHaveBeenCalled();
  });

  it("when the server reports a paid plan the wait ends and the URL is cleaned", () => {
    search = "?checkout=success";
    mount("free");
    advance(6_000);
    const before = refresh.mock.calls.length;
    mount("pro");
    expect(notice()).toBeNull();
    expect(replace).toHaveBeenCalledWith("/settings", { scroll: false });
    advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(before);
  });
});

describe("M4-06 the URL alone unlocks nothing", () => {
  it("an account that is already paid is not asked to wait", () => {
    search = "?checkout=success";
    mount("studio");
    expect(notice()).toBeNull();
    advance(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("checkout=canceled says the plan has not changed and polls nothing", () => {
    search = "?checkout=canceled";
    mount("free");
    expect(notice()!.textContent).toBe(CHECKOUT_CANCELED);
    expect(CHECKOUT_CANCELED).toBe("Checkout canceled. Your plan hasn’t changed.");
    advance(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no parameter, or a value that is not one of ours, renders nothing", () => {
    for (const value of ["", "?checkout=", "?checkout=yes", "?checkout=SUCCESS", "?checkout=success%20"]) {
      search = value;
      mount("free");
      expect(notice(), value).toBeNull();
    }
    advance(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("M4-07 a billing form that failed", () => {
  it("shows the message for a known error code as an alert", () => {
    search = "?billing_error=no_customer";
    mount("free");
    const box = notice()!;
    expect(box.getAttribute("role")).toBe("alert");
    expect(box.textContent).toBe("Nothing to manage yet.");
  });

  it("shows nothing for a code that is not one of ours (no text from the URL reaches the page)", () => {
    for (const code of ["<b>x</b>", "toString", "__proto__", "constructor", "nope"]) {
      search = `?billing_error=${encodeURIComponent(code)}`;
      mount("free");
      expect(notice(), code).toBeNull();
    }
  });
});

describe("parseCheckoutReturn", () => {
  it("accepts exactly success and canceled", () => {
    expect(parseCheckoutReturn("success")).toBe("success");
    expect(parseCheckoutReturn("canceled")).toBe("canceled");
    expect(parseCheckoutReturn("cancelled")).toBeNull();
    expect(parseCheckoutReturn(null)).toBeNull();
    expect(parseCheckoutReturn(undefined)).toBeNull();
  });
});
