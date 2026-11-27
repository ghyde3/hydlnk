import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftOf, makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";
import { join } from "./m19t-team-support";
import { enablePost } from "./content-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-13 (T7, G10): MCP stays owner-only. A token belongs to the user who consented and reaches only
 * that user's OWN sites: with a token of a publisher of S, every one of the 31 tools (14 page tools,
 * 17 content tools) given S's id, a sub-page of S, a post or a term of S answers the same not_found
 * as a missing id, list_pages omits S, nothing on S changes, and the owner's token is unchanged. The
 * page tools are refused by the page door's owner filter (page-access.ts), the entry tools by the
 * entry door (entry-access.ts: the writer's getEntry with source "mcp"), and every content-writer
 * call carries source "mcp", which `decide` maps to owner-only (m19t-access-rule pins the rule).
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M19-13 a member's MCP token reaches no shared site (local Supabase)", () => {
  let admin: SupabaseClient;
  let o: TestOwner;
  let p: TestOwner;
  let subPageId: string;
  let postId: string;
  let trashedId: string;
  let termId: string;
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
    // S's blog, a draft post, a trashed post and a tag, made with the OWNER's own token.
    await enablePost(admin as never, o.pageId);
    const owner = async (name: string, args: Record<string, unknown>) => {
      const result = await runTool(tools.toolByName(name)!, identity(o.userId), args, deps);
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent)}`);
      return JSON.parse((result.content as Array<{ text: string }>)[1]!.text) as { id: string; term: { id: string } };
    };
    postId = (await owner("create_entry", { pageId: o.pageId, title: "Owner's post", slug: "owners-post" })).id;
    trashedId = (await owner("create_entry", { pageId: o.pageId, title: "Trashed", slug: "trashed-post" })).id;
    await owner("delete_entry", { entryId: trashedId, ifRev: 1 });
    termId = (await owner("create_term", { pageId: o.pageId, taxonomy: "tag", name: "Owner's tag" })).term.id;
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
  /** The content tools' arguments on S: S's id, its post, its trashed post and its tag. */
  const CONTENT_ARGS = (pageId: string, entryId: string, trashed: string, term: string): Record<string, Record<string, unknown>> => ({
    list_content_types: { pageId },
    list_entries: { pageId },
    list_terms: { pageId },
    create_entry: { pageId, title: "Planted" },
    create_term: { pageId, taxonomy: "tag", name: "Planted" },
    rename_term: { pageId, termId: term, name: "Renamed" },
    delete_term: { pageId, termId: term },
    publish_design: { pageId, ifDesignRev: 1 },
    update_content_type: { pageId, enabled: false },
    get_entry: { entryId },
    list_revisions: { entryId },
    update_entry: { entryId, ifRev: 1, title: "Taken over" },
    delete_entry: { entryId, ifRev: 1 },
    restore_entry: { entryId: trashed, ifRev: 2 },
    restore_revision: { entryId, revision: 1, ifRev: 1 },
    publish_entry: { entryId, ifRev: 1 },
    unpublish_entry: { entryId, ifRev: 1 },
  });
  const errorOf = (result: { structuredContent?: unknown }) => (result.structuredContent as { error?: unknown })?.error;
  const codeOf = (result: { isError?: boolean; structuredContent?: unknown; content?: unknown }) =>
    result.isError ? ((result.structuredContent as { error?: { code?: string } })?.error?.code ?? JSON.stringify(result.content)) : "ok";

  it("M19-13 every page tool given S's id answers not_found to the member's token, like a missing id", async () => {
    const pageTools = tools.TOOLS.filter((tool) => tool.page === "one" && ARGS(o.pageId)[tool.name]);
    expect(pageTools.length).toBe(12);
    const missing = "11111111-1111-4111-8111-111111111111";
    for (const tool of pageTools) {
      const args = ARGS(o.pageId)[tool.name]!;
      const shared = await runTool(tool, identity(p.userId), args, deps);
      const absent = await runTool(tool, identity(p.userId), { ...args, pageId: missing }, deps);
      expect(codeOf(shared), tool.name).toBe("not_found");
      expect(errorOf(shared), tool.name).toEqual(errorOf(absent));
    }
    // A sub-page of S named by its own id is the same not_found.
    const getPage = tools.toolByName("get_page")!;
    expect(codeOf(await runTool(getPage, identity(p.userId), { pageId: subPageId }, deps))).toBe("not_found");
    // Nothing changed on S.
    const draft = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    expect((draft.data!.draft as { profile: { name: string } }).profile.name).toBe("Owner");
  });

  it("M19-13 every content tool given S's site, post or tag answers not_found to the member's token, like a missing id; nothing on S changes", async () => {
    const missing = "11111111-1111-4111-8111-111111111111";
    const args = CONTENT_ARGS(o.pageId, postId, trashedId, termId);
    const contentTools = tools.TOOLS.filter((tool) => args[tool.name]);
    expect(contentTools.length).toBe(17);
    const before = await admin.from("content_entries").select("id, rev, draft, deleted_at, published").in("id", [postId, trashedId]).order("id");
    for (const tool of contentTools) {
      const own = args[tool.name]!;
      // The id the tool keys on, replaced by one that exists nowhere.
      const keyed = tool.page === "entry" ? { ...own, entryId: missing } : { ...own, pageId: missing };
      const shared = await runTool(tool, identity(p.userId), own, deps);
      const absent = await runTool(tool, identity(p.userId), keyed, deps);
      expect(codeOf(shared), tool.name).toBe("not_found");
      expect(errorOf(shared), tool.name).toEqual(errorOf(absent));
    }
    // A sub-page of S through publish_entry (its page form) is the same not_found.
    const publishEntry = tools.toolByName("publish_entry")!;
    expect(codeOf(await runTool(publishEntry, identity(p.userId), { pageId: o.pageId, subPageId, ifRev: 1 }, deps))).toBe("not_found");
    // Nothing changed on S: its posts, its tag, its blog switch, and no post was planted.
    const after = await admin.from("content_entries").select("id, rev, draft, deleted_at, published").in("id", [postId, trashedId]).order("id");
    expect(after.data).toEqual(before.data);
    const term = await admin.from("content_terms").select("name").eq("id", termId).single();
    expect(term.data!.name).toBe("Owner's tag");
    const types = await admin.from("content_types").select("enabled").eq("site_id", o.pageId).eq("key", "post").single();
    expect(types.data!.enabled).toBe(true);
    const planted = await admin.from("content_entries").select("id").eq("site_id", o.pageId).eq("draft->>title", "Planted");
    expect(planted.data).toEqual([]);
    // The same reads with the owner's token answer (the refusal is the membership, not the arguments).
    for (const name of ["list_content_types", "list_entries", "list_terms", "get_entry", "list_revisions"]) {
      expect(codeOf(await runTool(tools.toolByName(name)!, identity(o.userId), args[name]!, deps)), name).toBe("ok");
    }
    // And the owner still writes: the post's draft takes the owner's edit at its current rev.
    const rev = Number(before.data!.find((row) => row.id === postId)!.rev);
    const edit = await runTool(tools.toolByName("update_entry")!, identity(o.userId), { entryId: postId, ifRev: rev, title: "Owner's edit" }, deps);
    expect(codeOf(edit)).toBe("ok");
  });

  it("M19-13 all 31 tools are covered: 14 page tools and 17 content tools", () => {
    const pageArgs = ARGS(o.pageId);
    const contentArgs = CONTENT_ARGS(o.pageId, postId, trashedId, termId);
    const covered = new Set([...Object.keys(pageArgs), ...Object.keys(contentArgs), "list_pages", "get_domains"]);
    expect(tools.TOOLS.length).toBe(31);
    expect(tools.TOOLS.map((tool) => tool.name).filter((name) => !covered.has(name))).toEqual([]);
    expect(Object.keys(pageArgs).length + 2).toBe(14);
    expect(Object.keys(contentArgs).length).toBe(17);
  });

  it("M19-13 get_domains lists none of S's domains to the member's token", async () => {
    const domain = await admin.from("domains").insert({ page_id: o.pageId, hostname: `m19mcp-${Date.now()}.example.com` });
    expect(domain.error).toBeNull();
    // The owner's token lists it, so the member's empty answer is the rule and not a missing row.
    const owners = JSON.stringify((await runTool(tools.toolByName("get_domains")!, identity(o.userId), {}, deps)).structuredContent);
    expect(owners).toContain("m19mcp-");
    const mine = JSON.stringify((await runTool(tools.toolByName("get_domains")!, identity(p.userId), {}, deps)).structuredContent);
    expect(mine).not.toContain(o.pageId);
    expect(mine).not.toContain("m19mcp-");
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
