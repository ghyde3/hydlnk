import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const getSessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>();
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => getSessionUser() }));

const accountHasPage = vi.fn<(id: string) => Promise<boolean>>();
const claimHandle =
  vi.fn<(id: string, handle: string) => Promise<{ ok: true } | { ok: false; error: string }>>();
vi.mock("@/lib/handles/claim", () => ({
  accountHasPage: (id: string) => accountHasPage(id),
  claimHandle: (id: string, handle: string) => claimHandle(id, handle),
}));

const readPendingHandle = vi.fn<() => Promise<string | null>>();
const clearPendingMetadata = vi.fn<(id: string) => Promise<void>>();
vi.mock("@/lib/handles/pending-server", () => ({
  readPendingHandle: () => readPendingHandle(),
  clearPendingMetadata: (id: string) => clearPendingMetadata(id),
}));

// Wave L (M10-12): after a claim the route asks whether an app's connection is waiting; its own test
// is m10-oauth-resume-claim.test.ts. Here nothing is waiting.
vi.mock("@/lib/oauth/resume", () => ({ oauthResumeAvailable: async () => false }));

const { GET } = await import("@/app/(editor)/app/claim/resume/route");

const APP = "http://app.localhost:3000";
const location = (response: Response) => response.headers.get("location");
const clearsCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .some((c) => /^hl-pending-handle=;/.test(c) && /max-age=0|expires=thu, 01 jan 1970/i.test(c));

/** M1-13 step 3: a chosen handle is claimed through the server-only claim after sign-in. */
describe("GET /claim/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    accountHasPage.mockResolvedValue(false);
    claimHandle.mockResolvedValue({ ok: true });
    readPendingHandle.mockResolvedValue("zq-gs-1");
  });

  it("claims the pending handle for the session user, clears the cookie and lands on /editor", async () => {
    const response = await GET();
    expect(claimHandle).toHaveBeenCalledWith("user-1", "zq-gs-1");
    expect(clearPendingMetadata).toHaveBeenCalledWith("user-1");
    expect(clearsCookie(response)).toBe(true);
    expect(location(response)).toBe(`${APP}/editor`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("creates nothing and clears the cookie when the account already has a page", async () => {
    accountHasPage.mockResolvedValue(true);
    const response = await GET();
    expect(claimHandle).not.toHaveBeenCalled();
    expect(clearsCookie(response)).toBe(true);
    expect(location(response)).toBe(`${APP}/editor`);
  });

  it("sends a handle taken in the meantime to /claim with the notice and clears the cookie", async () => {
    claimHandle.mockResolvedValue({ ok: false, error: "taken" });
    const response = await GET();
    expect(location(response)).toBe(`${APP}/claim?pending=done&handle=zq-gs-1&reason=taken`);
    expect(clearsCookie(response)).toBe(true);
  });

  it("sends any other refusal to /claim with the field prefilled", async () => {
    claimHandle.mockResolvedValue({ ok: false, error: "reserved" });
    const response = await GET();
    expect(location(response)).toBe(`${APP}/claim?pending=done&handle=zq-gs-1`);
  });

  it("ignores a missing, tampered or over-long pending handle: no claim, plain /claim", async () => {
    readPendingHandle.mockResolvedValue(null);
    const response = await GET();
    expect(claimHandle).not.toHaveBeenCalled();
    expect(location(response)).toBe(`${APP}/claim?pending=done`);
    expect(clearsCookie(response)).toBe(true);
  });

  it("sends a signed-out caller to /login and touches nothing", async () => {
    getSessionUser.mockResolvedValue(null);
    const response = await GET();
    expect(location(response)).toBe(`${APP}/login`);
    expect(claimHandle).not.toHaveBeenCalled();
    expect(clearPendingMetadata).not.toHaveBeenCalled();
  });
});
