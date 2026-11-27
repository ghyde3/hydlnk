import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftOf, makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";
import { join } from "./m19t-team-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-13 (T7, G10): MCP stays owner-only. A token belongs to the user who consented and reaches only
 * that user's OWN sites: with a token of a publisher of S, every page tool given S's id (or a
 * sub-page of S) answers the same not_found as a missing id, list_pages omits S, and the owner's
 * token is unchanged. The consent screen and the Connected apps card say so. (This base has the
 * fourteen page tools; the content tools of the MCP content wave go through the writer, where
 * `decide` maps source "mcp" to owner-only: m19t-access-rule pins it.)
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M19-13 a member's MCP token reaches no shared site (local Supabase)", () => {
  let admin: SupabaseClient;
  let o: TestOwner;
  let p: TestOwner;
  let subPageId: string;
  let tools: typeof import("@/lib/mcp/tools");
  let runTool: typeof import("@/lib/mcp/run-tool").runTool;
  let deps: import("@/lib/mcp/types").ToolDeps;

  beforeAll(async () => {
    admin = adminClient();
    tools = await import("@/lib/mcp/tools");
    ({ runTool } = await import("@/lib/mcp/run-tool"));
    const { createToolDeps } = await import("@/lib/mcp/deps");
    deps = { ...createToolDeps(), defer: () => undefined, log: () => undefined, limit: async () => ({ allowed: true, retryAfter: 0 }) };
    o = await makeOwner(admin, "m19mcp-o", () => draftOf("Owner"), "studio");
    await moveHome(admin, o.pageId);
    p = await makeOwner(admin, "m19mcp-p", () => draftOf("Member's own"));
    await join(admin, o, o.pageId, p, "publisher");
    const { createSubPageWithClient } = await import("@/lib/site-pages/sub-pages-core");
    const made = await createSubPageWithClient(admin as never, { userId: o.userId, source: "editor", siteId: o.pageId, title: "About", path: "about" });
    if (!made.ok) throw new Error("sub-page");
    subPageId = made.id;
  });
  afterAll(async () => {
    await removeOwners(admin, [o, p].filter(Boolean));
  });

  const identity = (userId: string) => ({
    userId,
    clientId: "client-m19",
    grantId: null,
    tokenId: `token-${userId}`,
    scopes: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
  });
  const ARGS = (pageId: string): Record<string, Record<string, unknown>> => ({
    get_page: { pageId },
    get_analytics: { pageId },
    update_profile: { pageId, ifRev: 1, name: "Taken over" },
    add_block: { pageId, ifRev: 1, type: "text", fields: { text: "x" } },
    update_block: { pageId, ifRev: 1, blockId: "lnk-aaaaaaaa", fields: { label: "y" } },
    move_block: { pageId, ifRev: 1, blockId: "lnk-aaaaaaaa", position: "first" },
    remove_block: { pageId, ifRev: 1, blockId: "lnk-aaaaaaaa" },
    create_page: { pageId, title: "Planted" },
    update_page_settings: { pageId, subPageId, title: "Renamed" },
    set_theme: { pageId, ifRev: 1, theme: "Noir" },
    create_preview_link: { pageId },
    publish_page: { pageId },
  });
  const codeOf = (result: { isError?: boolean; structuredContent?: unknown; content?: unknown }) =>
    result.isError ? ((result.structuredContent as { error?: { code?: string } })?.error?.code ?? JSON.stringify(result.content)) : "ok";

  it("M19-13 every page tool given S's id answers not_found to the member's token, like a missing id", async () => {
    const pageTools = tools.TOOLS.filter((tool) => tool.page === "one");
    expect(pageTools.length).toBe(12);
    const missing = "11111111-1111-4111-8111-111111111111";
    for (const tool of pageTools) {
      const args = ARGS(o.pageId)[tool.name];
      expect(args, `${tool.name} has test arguments`).toBeDefined();
      const shared = await runTool(tool, identity(p.userId), args, deps);
      const absent = await runTool(tool, identity(p.userId), { ...args, pageId: missing }, deps);
      expect(codeOf(shared), tool.name).toBe("not_found");
      expect(codeOf(absent), tool.name).toBe("not_found");
    }
    // A sub-page of S named by its own id is the same not_found.
    const getPage = tools.toolByName("get_page")!;
    expect(codeOf(await runTool(getPage, identity(p.userId), { pageId: subPageId }, deps))).toBe("not_found");
    // Nothing changed on S.
    const draft = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    expect((draft.data!.draft as { profile: { name: string } }).profile.name).toBe("Owner");
  });

  it("M19-13 list_pages lists the member's own site and omits S; the owner's token is unchanged", async () => {
    const list = tools.toolByName("list_pages")!;
    const mine = JSON.stringify((await runTool(list, identity(p.userId), {}, deps)).structuredContent);
    expect(mine).toContain(p.pageId);
    expect(mine).not.toContain(o.pageId);
    const owners = JSON.stringify((await runTool(list, identity(o.userId), {}, deps)).structuredContent);
    expect(owners).toContain(o.pageId);
    expect(codeOf(await runTool(tools.toolByName("get_page")!, identity(o.userId), { pageId: o.pageId }, deps))).toBe("ok");
  });

  it("S4: the sub-page core itself refuses a member when the source is mcp (and lets the same member in from the editor)", async () => {
    const { createSubPageWithClient } = await import("@/lib/site-pages/sub-pages-core");
    const viaMcp = await createSubPageWithClient(admin as never, { userId: p.userId, source: "mcp", siteId: o.pageId, title: "Planted", path: "planted-mcp" });
    expect(viaMcp).toMatchObject({ ok: false, error: "not_found" });
    const viaEditor = await createSubPageWithClient(admin as never, { userId: p.userId, source: "editor", siteId: o.pageId, title: "From the editor", path: "from-editor" });
    expect(viaEditor).toMatchObject({ ok: true });
  });

  it("M19-13 the consent screen and the Connected apps card say shared sites aren't included", async () => {
    const { SHARED_SITES_NOT_INCLUDED } = await import("@/lib/oauth/messages");
    expect(SHARED_SITES_NOT_INCLUDED).toBe("Sites shared with you aren’t included.");
    for (const file of ["src/components/oauth/consent-screen.tsx", "src/components/settings/connected-apps-card.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toContain("{SHARED_SITES_NOT_INCLUDED}");
    }
  });
});
