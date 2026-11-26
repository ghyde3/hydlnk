import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S4 (M19-13): the MCP tools tell the cores where the call came from. create_page and publish_page
 * pass `source: "mcp"`, so the access helper's decide() applies its owner-only rule in the core as
 * well as in page-access.ts (a member's token reaches no shared site even if a tool's own check were
 * ever loosened). The editor's sub-page route passes "editor".
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));
const create = vi.fn(async (..._args: unknown[]) => ({ ok: false, error: "not_found", message: "x" }));
vi.mock("@/lib/site-pages/sub-pages-core", () => ({ createSubPageWithClient: create }));
const publish = vi.fn(async (..._args: unknown[]) => ({ ok: false, errors: [], reason: "not_found" }));
vi.mock("@/lib/publish/core", () => ({ publishPageCore: publish }));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage: vi.fn() }));
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

const { createPage } = await import("@/lib/mcp/tools/create-page");
const { publishPage } = await import("@/lib/mcp/tools/publish-page");
const { createSubPage } = await import("@/lib/site-pages/sub-pages");

const USER = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const call = { userId: USER, admin: {}, page: { id: SITE } } as never;

beforeEach(() => {
  create.mockClear();
  publish.mockClear();
});

describe("S4 the MCP tools pass their real source", () => {
  it("create_page asks the core with source mcp", async () => {
    await createPage.handler({ pageId: SITE, title: "About" } as never, call).catch(() => undefined);
    expect(create).toHaveBeenCalledWith({}, expect.objectContaining({ userId: USER, siteId: SITE, source: "mcp" }));
  });

  it("publish_page asks the core with source mcp", async () => {
    await publishPage.handler({ pageId: SITE } as never, call).catch(() => undefined);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: SITE, userId: USER, source: "mcp" }),
      expect.anything(),
    );
  });

  it("the editor's sub-page create passes editor, and the body cannot name the user or the source", async () => {
    await createSubPage(USER, SITE, { title: "About", userId: "someone", source: "mcp" } as never);
    expect(create).toHaveBeenCalledWith({}, expect.objectContaining({ userId: USER, siteId: SITE, source: "editor" }));
  });
});
