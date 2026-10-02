// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * M5-20: when Supabase answers over_email_send_rate_limit the sign-in form says "Too many sign-in
 * emails. Try again in a little while." and keeps the typed address. The same code is also what the
 * 60 second per-address limit answers (M1-03, "You can request another link in a minute."): they are
 * told apart by the message, and the raw Supabase text never reaches the page. The mapping is proven
 * here against a mocked Supabase client (the live limiter is not raised on demand); the minute case
 * is proven live by tests/e2e/m1/auth-login.spec.ts.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
});

const requestSignInLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/actions", () => ({
  requestSignInLink: requestSignInLink,
}));
vi.mock("@/components/auth/google-button", () => ({
  GoogleButton: () => null,
  OrDivider: () => null,
}));
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement("a", { href: props.href }, props.children as never),
}));

type OtpError = { status?: number; code?: string; message?: string } | null;
let otpError: OtpError = null;
const signInWithOtp = vi.fn(async () => ({ error: otpError }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithOtp } }),
}));

const PER_ADDRESS = {
  status: 429,
  code: "over_email_send_rate_limit",
  message: "For security purposes, you can only request this after 59 seconds.",
};
const HOURLY = {
  status: 429,
  code: "over_email_send_rate_limit",
  message: "email rate limit exceeded",
};

const { classifyOtpError, TOO_MANY_EMAILS_MESSAGE } = await import("@/lib/auth/otp-error");
const { sendSignInLink } = await import("@/lib/auth/magic-link");
const { sendSignupLink } = await import("@/lib/handles/signup-link");

beforeEach(() => {
  otpError = null;
  signInWithOtp.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("M5-20 classifyOtpError", () => {
  it("over_email_send_rate_limit with the per-address message is the minute wording (M1-03)", () => {
    expect(classifyOtpError(PER_ADDRESS)).toBe("rate_limited");
    expect(
      classifyOtpError({
        ...PER_ADDRESS,
        message: "FOR SECURITY PURPOSES, you can ONLY REQUEST THIS after 3 seconds.",
      }),
    ).toBe("rate_limited");
  });

  it("over_email_send_rate_limit with any other message is the hourly limit", () => {
    expect(classifyOtpError(HOURLY)).toBe("too_many_emails");
    expect(classifyOtpError({ code: "over_email_send_rate_limit" })).toBe("too_many_emails");
    expect(classifyOtpError({ status: 429, code: "over_email_send_rate_limit", message: "" })).toBe(
      "too_many_emails",
    );
  });

  it("another 429 (a request rate limit) keeps the minute wording; everything else is a plain failure", () => {
    expect(classifyOtpError({ status: 429 })).toBe("rate_limited");
    expect(
      classifyOtpError({ code: "over_request_rate_limit", message: "Request rate limit reached" }),
    ).toBe("rate_limited");
    expect(classifyOtpError({ status: 500, code: "unexpected_failure" })).toBe("failed");
    expect(classifyOtpError({ status: 400, code: "validation_failed" })).toBe("failed");
    expect(classifyOtpError({})).toBe("failed");
  });

  it("the sentence is exactly the acceptance's, in the DESIGN.md voice", () => {
    expect(TOO_MANY_EMAILS_MESSAGE).toBe("Too many sign-in emails. Try again in a little while.");
    expect(TOO_MANY_EMAILS_MESSAGE).not.toMatch(/please|!|successfully/i);
  });
});

describe("M5-20 sendSignInLink and sendSignupLink report each limit on its own", () => {
  const cases: Array<[string, OtpError, string]> = [
    ["the per-address limit", PER_ADDRESS, "rate_limited"],
    ["the hourly email limit", HOURLY, "too_many_emails"],
    [
      "a request rate limit",
      { status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" },
      "rate_limited",
    ],
    ["a server error", { status: 500, code: "unexpected_failure", message: "boom" }, "failed"],
  ];

  for (const [name, error, expected] of cases) {
    it(`log in: ${name} -> ${expected}`, async () => {
      otpError = error;
      expect(await sendSignInLink("a@example.com")).toEqual({ ok: false, error: expected });
      expect(signInWithOtp).toHaveBeenCalledTimes(1);
    });
    it(`sign up: ${name} -> ${expected}`, async () => {
      otpError = error;
      expect(await sendSignupLink("a@example.com", "somebody")).toEqual({
        ok: false,
        error: expected,
      });
    });
  }

  it("success is still ok, and a bad address never reaches Supabase", async () => {
    expect(await sendSignInLink("a@example.com")).toEqual({ ok: true });
    signInWithOtp.mockClear();
    expect(await sendSignInLink("not-an-email")).toEqual({ ok: false, error: "invalid_email" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("neither limit logs the raw Supabase text (only a real failure does)", async () => {
    otpError = HOURLY;
    await sendSignInLink("a@example.com");
    otpError = PER_ADDRESS;
    await sendSignupLink("a@example.com", "somebody");
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("M5-20 the sign-in form", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    requestSignInLink.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const input = () => host.querySelector<HTMLInputElement>("#login-email")!;
  const form = () => host.querySelector("form")!;
  const mount = async (props: { notice?: string } = {}) => {
    const { LoginForm } = await import("@/components/auth/login-form");
    await act(async () => root.render(createElement(LoginForm, props)));
  };
  const typeAndSubmit = async (value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };

  it("hourly limit: the sentence, as an alert, and the typed address stays in the field", async () => {
    requestSignInLink.mockResolvedValue({ ok: false, error: "too_many_emails" });
    await mount();
    await typeAndSubmit("keep@example.com");
    const alert = host.querySelector("[role=alert]")!;
    expect(alert.textContent).toBe("Too many sign-in emails. Try again in a little while.");
    expect(input().value).toBe("keep@example.com");
    expect(requestSignInLink).toHaveBeenCalledWith("keep@example.com");
    // Still the form: no "Check your email".
    expect(host.textContent).not.toContain("Check your email");
    expect(document.activeElement).toBe(input());
    expect(host.textContent).not.toMatch(
      /over_email_send_rate_limit|rate limit exceeded|security purposes/i,
    );
  });

  it("the per-address limit keeps the M1 wording", async () => {
    requestSignInLink.mockResolvedValue({ ok: false, error: "rate_limited" });
    await mount();
    await typeAndSubmit("keep@example.com");
    expect(host.querySelector("[role=alert]")!.textContent).toBe(
      "You can request another link in a minute.",
    );
    expect(input().value).toBe("keep@example.com");
  });

  it("arriving with an expired-link message puts the focus in the email field", async () => {
    await mount({ notice: "That sign-in link expired or was already used. Request a new one." });
    expect(host.querySelector("[role=alert]")!.textContent).toContain(
      "expired or was already used",
    );
    expect(document.activeElement).toBe(input());
  });

  it("without a message the field is not focused for the person", async () => {
    await mount();
    expect(document.activeElement).not.toBe(input());
  });
});
