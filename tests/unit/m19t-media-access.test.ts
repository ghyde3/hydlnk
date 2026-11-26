import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * M19-05, M19-06 (A31, A32, T15, T16): POST /api/media and /api/media/cleanup with the `x-hl-site` header. The
 * access helper decides (edit); the folder, the quota and the cleanup queue are the site OWNER's;
 * the rate limit and the suspension check are the uploader's; a site the user may not edit stores
 * nothing and answers 404 with the lost-access sentence.
 */
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "00000000-0000-4000-8000-0000000000a9";
const SITE = "00000000-0000-4000-8000-0000000000b1";

const m = vi.hoisted(() => ({
  user: { id: "" },
  access: vi.fn(),
  suspended: vi.fn(async () => false),
  process: vi.fn(async () => ({ ok: true, image: { path: "p", width: 1, height: 1, url: "u" } })),
  quota: vi.fn((owner: string) => ({ quotaOf: owner })),
  rate: vi.fn((uploader: string) => ({ rateOf: uploader })),
  queue: vi.fn(async () => undefined),
  cleanup: vi.fn(async () => ({ deleted: [], kept: [] })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => m.user }));
vi.mock("@/lib/access/server", () => ({ siteAccessFor: m.access }));
vi.mock("@/lib/admin/suspension", () => ({
  isAccountSuspended: m.suspended,
  suspendedBody: () => ({ error: "forbidden", code: "account_suspended", message: "x" }),
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));
vi.mock("@/lib/media/upload", () => ({ processUpload: m.process }));
vi.mock("@/lib/media/quota", () => ({ adminUploadQuota: m.quota }));
vi.mock("@/lib/media/rate-limit", () => ({ adminUploadRateLimit: m.rate }));
vi.mock("@/lib/media/cleanup-admin", () => ({
  queueNewUpload: m.queue,
  cleanupMediaFor: m.cleanup,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));

const upload = await import("@/app/(editor)/app/api/media/route");
const cleanup = await import("@/app/(editor)/app/api/media/cleanup/route");

const post = (path: string, site?: string) =>
  new NextRequest(`http://app.localhost:3000${path}`, {
    method: "POST",
    headers: site ? { "x-hl-site": site } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.user = { id: MEMBER };
});

describe("M19-06 uploads on a shared site", () => {
  it("M19-05 a member's upload with site goes to the OWNER's folder and quota; the rate limit is the uploader's", async () => {
    m.access.mockResolvedValue({ ok: true, access: { ownerId: OWNER, actorId: MEMBER, siteId: SITE } });
    const res = await upload.POST(post("/api/media", SITE));
    expect(res.status).toBe(200);
    expect(m.access).toHaveBeenCalledWith({
      actorId: MEMBER,
      siteId: SITE,
      need: "edit",
      source: "editor",
    });
    const [, folder, , quota, options] = m.process.mock.calls[0] as unknown as [
      unknown,
      string,
      unknown,
      unknown,
      { rateLimit: unknown; queue: (p: string) => unknown },
    ];
    expect(folder).toBe(OWNER);
    expect(quota).toEqual({ quotaOf: OWNER });
    expect(options.rateLimit).toEqual({ rateOf: MEMBER });
    // S3: every stored path goes on the OWNER's cleanup queue (with its grace), as the site's row.
    await options.queue(`${OWNER}/img-x.webp`);
    expect(m.queue).toHaveBeenCalledWith(OWNER, `${OWNER}/img-x.webp`, undefined, SITE);
    // Finding 1: a member's reclaim for room is scoped to the site, past the Undo window.
    expect(m.quota).toHaveBeenCalledWith(OWNER, undefined, { siteId: SITE, before: expect.any(Date) });
    expect(m.suspended).toHaveBeenCalledWith(MEMBER);
  });

  it("M19-11 a site the user may not edit (removed, paused, a stranger's) stores nothing: 404", async () => {
    m.access.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await upload.POST(post("/api/media", SITE));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "You no longer have access to this site.",
    });
    expect(m.process).not.toHaveBeenCalled();
  });

  it("M19-06 a suspended uploader is refused before the site is asked", async () => {
    m.suspended.mockResolvedValueOnce(true);
    const res = await upload.POST(post("/api/media", SITE));
    expect(res.status).toBe(403);
    expect(m.access).not.toHaveBeenCalled();
    expect(m.process).not.toHaveBeenCalled();
  });

  it("G22: an upload without site (an old bundle) stores nothing and says to reload", async () => {
    m.user = { id: OWNER };
    const res = await upload.POST(post("/api/media"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "site_required",
      message: "The editor was updated. Reload the page, then add the image again.",
    });
    expect(m.access).not.toHaveBeenCalled();
    expect(m.process).not.toHaveBeenCalled();
  });

  it("M19-06 cleanup with site works off the OWNER's queue; a site the user may not edit runs nothing", async () => {
    m.access.mockResolvedValueOnce({ ok: true, access: { ownerId: OWNER, actorId: MEMBER, siteId: SITE } });
    expect((await cleanup.POST(post("/api/media/cleanup", SITE))).status).toBe(200);
    // Finding 1: a member works only the site's rows queued before the Undo window.
    const [owner, , scope] = m.cleanup.mock.calls[0] as unknown as [string, unknown, { siteId: string; before: Date }];
    expect(owner).toBe(OWNER);
    expect(scope.siteId).toBe(SITE);
    expect(Date.now() - scope.before.getTime()).toBeGreaterThanOrEqual(10_000);
    m.access.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect((await cleanup.POST(post("/api/media/cleanup", SITE))).status).toBe(404);
    expect(m.cleanup).toHaveBeenCalledTimes(1);
  });

  it("finding 1: the owner's own call with site still works the whole queue", async () => {
    m.user = { id: OWNER };
    m.access.mockResolvedValueOnce({ ok: true, access: { ownerId: OWNER, actorId: OWNER, siteId: SITE } });
    expect((await cleanup.POST(post("/api/media/cleanup", SITE))).status).toBe(200);
    expect(m.cleanup).toHaveBeenCalledWith(OWNER);
  });
});
