import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));
const ensureAccount = vi.fn<(id: string) => Promise<void>>();
vi.mock("@/lib/auth/accounts", () => ({ ensureAccount: (id: string) => ensureAccount(id) }));

const accountHasPage = vi.fn<(id: string) => Promise<boolean>>();
vi.mock("@/lib/handles/claim", () => ({ accountHasPage: (id: string) => accountHasPage(id) }));

import { handleAuthCallback } from "@/lib/auth/callback";

const APP = "http://app.localhost:3000";
const call = (query: string) => handleAuthCallback(new Request(`${APP}/auth/callback${query}`));
const location = (response: Response) => response.headers.get("location");

beforeEach(() => {
  vi.clearAllMocks();
  accountHasPage.mockResolvedValue(false);
});

describe("M1-04 auth callback: emailed link", () => {
  it("verifies the token hash, ensures the account and lands on /", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const response = await call("?token_hash=abc&type=email");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email" });
    expect(ensureAccount).toHaveBeenCalledWith("user-1");
    expect(location(response)).toBe(`${APP}/`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps otp_expired to /login?error=link_invalid and creates nothing", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthApiError", code: "otp_expired", status: 403, message: "expired" },
    });
    const response = await call("?token_hash=used&type=email");
    expect(location(response)).toBe(`${APP}/login?error=link_invalid`);
    expect(ensureAccount).not.toHaveBeenCalled();
  });

  it("maps an invalid token to the same redirect", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: {
        name: "AuthApiError",
        code: "validation_failed",
        status: 403,
        message: "Token has expired or is invalid",
      },
    });
    const response = await call("?token_hash=bad&type=email");
    expect(location(response)).toBe(`${APP}/login?error=link_invalid`);
  });

  it("rejects token types that are not sign-in links without calling Supabase", async () => {
    for (const type of ["recovery", "invite", "email_change", "sms"]) {
      const response = await call(`?token_hash=abc&type=${type}`);
      expect(location(response)).toBe(`${APP}/login?error=link_invalid`);
    }
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("redirects to /login when there are no parameters", async () => {
    const response = await call("");
    expect(location(response)).toBe(`${APP}/login`);
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it.each([
    "next=https://evil.example",
    "next=//evil.example",
    "next=/%5Cevil.example",
    "next=javascript:alert(1)",
    "redirect_to=https://evil.example",
    "returnTo=https://evil.example",
  ])("ignores %s: success always lands on /", async (extra) => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const response = await call(`?token_hash=abc&type=email&${extra}`);
    expect(location(response)).toBe(`${APP}/`);
  });

  it("still signs in when the account self-heal fails", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    ensureAccount.mockRejectedValueOnce(new Error("db down"));
    const response = await call("?token_hash=abc&type=email");
    expect(location(response)).toBe(`${APP}/`);
  });
});

describe("M1-08 auth callback: Google", () => {
  it("exchanges the code for a google user, creates the account like the email path and lands on /", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "google-user-1", app_metadata: { provider: "google" } }, session: {} },
      error: null,
    });
    const response = await call("?code=oauth-code");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(ensureAccount).toHaveBeenCalledWith("google-user-1");
    expect(location(response)).toBe(`${APP}/`);
  });

  it("redirects a provider error to /login?error=link_invalid without a session", async () => {
    const response = await call("?error=access_denied&error_description=User+cancelled");
    expect(location(response)).toBe(`${APP}/login?error=link_invalid`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends a failed code exchange to /login?error=link_invalid", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: "bad code" },
    });
    const response = await call("?code=stale");
    expect(location(response)).toBe(`${APP}/login?error=link_invalid`);
    expect(ensureAccount).not.toHaveBeenCalled();
  });
});

describe("M1-13 pending handle cookie at the callback", () => {
  const withCookie = (query: string) =>
    handleAuthCallback(
      new Request(`${APP}/auth/callback${query}`, {
        headers: { cookie: "hl-pending-handle=zq-gs-1; other=1" },
      }),
    );
  const clearsPending = (response: Response) =>
    response.headers
      .getSetCookie()
      .some((c) => /^hl-pending-handle=;/.test(c) && /max-age=0|expires=thu, 01 jan 1970/i.test(c));

  beforeEach(() => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "g-1" } }, error: null });
  });

  it("drops the cookie when the account already has a page (no second page is ever claimed)", async () => {
    accountHasPage.mockResolvedValue(true);
    const response = await withCookie("?code=abc");
    expect(accountHasPage).toHaveBeenCalledWith("g-1");
    expect(clearsPending(response)).toBe(true);
    expect(location(response)).toBe(`${APP}/`);
  });

  it("keeps the cookie for an account without a page: /claim/resume claims it", async () => {
    const response = await withCookie("?code=abc");
    expect(clearsPending(response)).toBe(false);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("does not look anything up when there is no cookie", async () => {
    const response = await call("?code=abc");
    expect(accountHasPage).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
