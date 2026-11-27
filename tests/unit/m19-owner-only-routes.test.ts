import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rateLimit: vi.fn(),
  loadStats: vi.fn(),
  loadExport: vi.fn(),
  loadAudience: vi.fn(),
  loadAudienceExport: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/pages/context", () => ({ getAppContext: mocks.context }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/analytics/dashboard/load", () => ({
  loadStatsResponse: mocks.loadStats,
  loadExportResponse: mocks.loadExport,
}));
vi.mock("@/lib/forms/audience", () => ({
  loadAudience: mocks.loadAudience,
  loadAudienceExport: mocks.loadAudienceExport,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/audience/audience-screen", () => ({ AudienceScreen: () => null }));

const analyticsExport = await import("@/app/(editor)/app/(screens)/analytics/export/route");
const analyticsStats = await import("@/app/(editor)/app/(screens)/analytics/stats/route");
const audienceExport = await import("@/app/(editor)/app/(screens)/audience/export/route");
const { default: AudiencePage } = await import("@/app/(editor)/app/(screens)/audience/page");

/**
 * Wave F, G3 (M19-10): analytics and the audience are the owner's. A member's session (here a
 * publisher, the role with the most access) on the shared site gets the same answer as a missing
 * page from each of the four surfaces, and none of their loaders runs: the stats JSON and the two
 * CSV exports answer 404 not_found, and the Audience screen calls notFound(). The owner's context
 * reaches each loader, so the refusal is the role and not the request.
 */

const SITE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const context = (isOwner: boolean) => ({
  user: { id: isOwner ? "owner-user" : "publisher-user" },
  plan: "studio",
  current: {
    id: SITE,
    handle: "mara",
    name: "Mara",
    access: { isOwner, role: isOwner ? "owner" : "publisher", canEdit: true, canPublish: true },
  },
});
const get = (path: string) => new NextRequest(`http://app.localhost:3000${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.loadStats.mockResolvedValue({ ok: false, error: "load_failed" });
  mocks.loadExport.mockResolvedValue({ ok: false, error: "load_failed" });
  mocks.loadAudience.mockResolvedValue(null);
  mocks.loadAudienceExport.mockResolvedValue({ rows: [], labels: new Map() });
});

describe("M19-10 owner-only routes refuse a member like a missing page", () => {
  it("GET /analytics/export: a publisher gets 404 not_found and nothing is loaded", async () => {
    mocks.context.mockResolvedValue(context(false));
    const res = await analyticsExport.GET(get("/analytics/export?kind=daily&range=30"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    expect(mocks.loadExport).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("GET /analytics/stats: a publisher gets 404 not_found and nothing is loaded", async () => {
    mocks.context.mockResolvedValue(context(false));
    const res = await analyticsStats.GET(get("/analytics/stats?range=30"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    expect(mocks.loadStats).not.toHaveBeenCalled();
  });

  it("GET /audience/export: a publisher gets 404 not_found and nothing is loaded", async () => {
    mocks.context.mockResolvedValue(context(false));
    const res = await audienceExport.GET(get("/audience/export?form=all"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    expect(mocks.loadAudienceExport).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("the Audience screen: a publisher's render is notFound() and nothing is loaded", async () => {
    mocks.context.mockResolvedValue(context(false));
    await expect(
      AudiencePage({ searchParams: Promise.resolve({}) } as never),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.loadAudience).not.toHaveBeenCalled();
  });

  it("the owner's context reaches every loader (the refusal is the role)", async () => {
    mocks.context.mockResolvedValue(context(true));
    await analyticsExport.GET(get("/analytics/export?kind=daily&range=30"));
    await analyticsStats.GET(get("/analytics/stats?range=30"));
    expect((await audienceExport.GET(get("/audience/export?form=all"))).status).toBe(200);
    await AudiencePage({ searchParams: Promise.resolve({}) } as never);
    expect(mocks.loadExport).toHaveBeenCalledTimes(1);
    expect(mocks.loadStats).toHaveBeenCalledTimes(1);
    expect(mocks.loadAudienceExport).toHaveBeenCalledTimes(1);
    expect(mocks.loadAudience).toHaveBeenCalledTimes(1);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
