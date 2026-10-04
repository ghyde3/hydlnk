import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M10-12: a new account that signs up through an app's connection claims its handle at /claim/resume
 * and then goes back to the consent screen, when the request is still inside its ten minutes (the
 * resume check says so); otherwise it lands on the editor with no message.
 */

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

vi.mock("@/lib/handles/pending-server", () => ({
  readPendingHandle: async () => "zq-gs-1",
  clearPendingMetadata: async () => undefined,
}));

const oauthResumeAvailable = vi.fn<(id: string) => Promise<boolean>>();
vi.mock("@/lib/oauth/resume", () => ({
  oauthResumeAvailable: (id: string) => oauthResumeAvailable(id),
}));

const { GET } = await import("@/app/(editor)/app/claim/resume/route");

const APP = "http://app.localhost:3000";

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
  accountHasPage.mockResolvedValue(false);
  claimHandle.mockResolvedValue({ ok: true });
});

describe("M10-12 /claim/resume resumes a waiting connection", () => {
  it("goes to the consent screen (no query) after a claim when the request is still open", async () => {
    oauthResumeAvailable.mockResolvedValue(true);
    const response = await GET();
    expect(oauthResumeAvailable).toHaveBeenCalledWith("user-1");
    expect(response.headers.get("location")).toBe(`${APP}/oauth/authorize`);
    expect(response.headers.get("location")).not.toContain("?");
    expect(response.headers.getSetCookie().some((c) => /^hl-pending-handle=;/.test(c))).toBe(true);
  });

  it("lands on the editor, with no message, when nothing is waiting", async () => {
    oauthResumeAvailable.mockResolvedValue(false);
    const response = await GET();
    expect(response.headers.get("location")).toBe(`${APP}/editor`);
  });

  it("does not look for a connection when the claim failed and the person is sent back to /claim", async () => {
    claimHandle.mockResolvedValue({ ok: false, error: "taken" });
    const response = await GET();
    expect(oauthResumeAvailable).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toMatch(/\/claim\?pending=done/);
  });

  it("an account that already has a page resumes too", async () => {
    accountHasPage.mockResolvedValue(true);
    oauthResumeAvailable.mockResolvedValue(true);
    const response = await GET();
    expect(response.headers.get("location")).toBe(`${APP}/oauth/authorize`);
  });
});
