import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M11-08 step 2: deleting a page through the route expires the site's cache tag, so the live route
 * answers 404 and the live menu drops the entry on the next request. The database call, the session
 * and the cache are stubbed; the route and `deleteSubPage` are real.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

const mocks = vi.hoisted(() => ({
  invalidatePage: vi.fn(),
  getSessionUser: vi.fn(),
  core: vi.fn(),
}));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage: mocks.invalidatePage }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/site-pages/sub-pages-core", () => ({
  createSubPageWithClient: vi.fn(),
  deleteSubPageWithClient: mocks.core,
  SUB_PAGE_MESSAGES: { delete_failed: "Couldn’t delete the page. Try again." },
}));

const SITE = "00000000-0000-4000-8000-0000000000b1";
const SUB = "00000000-0000-4000-8000-0000000000a1";

async function del() {
  const { DELETE } = await import("@/app/(editor)/app/api/pages/[id]/sub-pages/[subId]/route");
  const request = new Request(`http://app.localhost:3000/api/pages/${SITE}/sub-pages/${SUB}`, {
    method: "DELETE",
  });
  return DELETE(request as never, { params: Promise.resolve({ id: SITE, subId: SUB }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionUser.mockResolvedValue({ id: "user-1" });
});

describe("DELETE /api/pages/{id}/sub-pages/{subId}", () => {
  it("expires the site's cache after a delete, with the site id", async () => {
    mocks.core.mockResolvedValue({ ok: true, id: SUB, siteId: SITE });
    const response = await del();
    expect(response.status).toBe(200);
    expect(mocks.invalidatePage).toHaveBeenCalledTimes(1);
    expect(mocks.invalidatePage).toHaveBeenCalledWith(SITE);
  });

  it("a failed expiry does not fail the delete (the 24-hour backstop remains)", async () => {
    mocks.core.mockResolvedValue({ ok: true, id: SUB, siteId: SITE });
    mocks.invalidatePage.mockImplementation(() => {
      throw new Error("cache down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await del()).status).toBe(200);
  });

  it("expires nothing when nothing was deleted, and nothing without a session", async () => {
    mocks.core.mockResolvedValue({ ok: false, error: "not_found", message: "x", status: 404 });
    expect((await del()).status).toBe(404);
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await del()).status).toBe(401);
    expect(mocks.invalidatePage).not.toHaveBeenCalled();
  });
});
