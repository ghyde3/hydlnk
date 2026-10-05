import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return actual;
});

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.test" } }));
const cleanupMediaFor = vi.fn();
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaFor }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit }));

const { POST } = await import("@/app/(editor)/app/api/media/cleanup/route");

const USER = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const request = () => ({ headers: new Headers() }) as unknown as import("next/server").NextRequest;

beforeEach(() => {
  getSessionUser.mockReset().mockResolvedValue({ id: USER });
  cleanupMediaFor.mockReset().mockResolvedValue({ deleted: [], kept: [], discarded: [] });
  rateLimit.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
});

describe("M11-12 POST /api/media/cleanup is rate limited per account", () => {
  it("counts the session user under media-cleanup:<id>, 20 a minute, then works the queue", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith(`media-cleanup:${USER}`, 20, 60);
    expect(cleanupMediaFor).toHaveBeenCalledWith(USER);
  });

  it("past the limit it answers 429 rate_limited with Retry-After and does not touch the queue", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 17 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(cleanupMediaFor).not.toHaveBeenCalled();
  });

  it("an unauthenticated call is a 401 and is not counted", async () => {
    getSessionUser.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
