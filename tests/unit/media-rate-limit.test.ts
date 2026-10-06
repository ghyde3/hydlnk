import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the unit test must pass its own client");
  },
}));

const { adminUploadRateLimit } = await import("@/lib/media/rate-limit");
const { UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_SECONDS } = await import("@/lib/media/limits");

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

/** M5-13: the limiter is the database's sliding window, called with the verified user and the constants. */
function client(answer: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }));
  return { rpc } as never as { rpc: typeof rpc };
}

describe("M5-13 adminUploadRateLimit", () => {
  it("is 20 requests per hour", () => {
    expect(UPLOAD_RATE_LIMIT).toBe(20);
    expect(UPLOAD_RATE_WINDOW_SECONDS).toBe(3600);
  });

  it("calls media_upload_rate_hit with the user, the limit and the window, and nothing from the request", async () => {
    const admin = client({ data: [{ allowed: true, retry_after: 0 }] });
    const limit = adminUploadRateLimit(UID, admin as never);
    expect(await limit.hit()).toEqual({ allowed: true, retryAfter: 0 });
    expect(admin.rpc).toHaveBeenCalledWith("media_upload_rate_hit", {
      p_uid: UID,
      p_limit: 20,
      p_window_seconds: 3600,
    });
  });

  it("reads a refusal and its retry_after", async () => {
    const admin = client({ data: [{ allowed: false, retry_after: 1234 }] });
    expect(await adminUploadRateLimit(UID, admin as never).hit()).toEqual({
      allowed: false,
      retryAfter: 1234,
    });
  });

  it("accepts a bare row as well as an array", async () => {
    const admin = client({ data: { allowed: false, retry_after: 5 } });
    expect(await adminUploadRateLimit(UID, admin as never).hit()).toEqual({
      allowed: false,
      retryAfter: 5,
    });
  });

  it("throws on a database error and on an answer it cannot read (the route logs it and lets the request through)", async () => {
    await expect(
      adminUploadRateLimit(UID, client({ error: { message: "boom" } }) as never).hit(),
    ).rejects.toThrow("Upload rate limit failed: boom");
    await expect(adminUploadRateLimit(UID, client({ data: [] }) as never).hit()).rejects.toThrow(
      "no answer",
    );
    await expect(
      adminUploadRateLimit(UID, client({ data: [{ allowed: "yes" }] }) as never).hit(),
    ).rejects.toThrow("no answer");
  });
});
