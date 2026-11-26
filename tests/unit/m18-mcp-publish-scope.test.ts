/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENTRY_A,
  PAGE_A,
  TYPE_A,
  USER_A,
  USER_B,
  identity,
  makeDeps,
  ownedEntry,
  ownedPage,
} from "./support/mcp-fakes";
import {
  CONTENT_TOOL_INPUTS,
  CONTENT_TOOL_NAMES,
  PUBLISH_SCOPE_TOOL_NAMES,
  TERM_A,
} from "./support/mcp-content";

/**
 * M18-08 and abuse cases 4 and 5: anything that changes what a visitor can see needs
 * `hydlnk.publish`; drafts need `hydlnk.write`; reads need `hydlnk.read`. The scope is checked
 * first, before the limiter and before any read. No database: the writer and the Publish gate are
 * spies, so each test says what a refused call did NOT reach, and what an allowed one was handed.
 */

const writer = vi.hoisted(() => {
  const names = [
    "createEntry",
    "updateEntry",
    "publishEntry",
    "unpublishEntry",
    "trashEntry",
    "restoreEntry",
    "getEntry",
    "listEntries",
    "enableType",
    "updateType",
    "createTerm",
    "renameTerm",
    "deleteTerm",
    "setEntryTerms",
    "listRevisions",
    "restoreRevision",
    "listTypes",
    "listTerms",
    "countEntries",
    "checkPostBody",
  ] as const;
  return Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<
    (typeof names)[number],
    ReturnType<typeof vi.fn>
  >;
});
const gate = vi.hoisted(() => ({
  publishPageCore: vi.fn(),
  publishSitePageCore: vi.fn(),
  publishDesignCore: vi.fn(),
}));
const cache = vi.hoisted(() => ({ invalidatePage: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));
vi.mock("@/lib/content", () => writer);
vi.mock("@/lib/publish/core", () => gate);
vi.mock("@/lib/publish/invalidate", () => cache);
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly: vi.fn() }));
vi.mock("@/lib/mcp/page-access", async (original) => ({
  ...(await original<typeof import("@/lib/mcp/page-access")>()),
  loadAccountPlan: async () => "free",
  listPageDomains: async () => [],
}));

const { runTool } = await import("@/lib/mcp/run-tool");
const { TOOLS, toolByName } = await import("@/lib/mcp/tools");
const { identityOf } = await import("@/lib/mcp/server");
const { MCP_SCOPES } = await import("@/lib/mcp/constants");

const READ = [MCP_SCOPES.read];
const READ_WRITE = [MCP_SCOPES.read, MCP_SCOPES.write];
const failure = (result: any) => result.structuredContent.error as Record<string, any>;
const TYPE = {
  typeId: TYPE_A,
  key: "post",
  label: "Post",
  labelPlural: "Blog",
  enabled: true,
  archivePath: "blog",
};
const place = { siteId: PAGE_A, typeId: TYPE_A, typeKey: "post" };

/** Every writer and gate call answers as a success would. */
function allowEverything() {
  writer.createEntry.mockResolvedValue({ ok: true, id: ENTRY_A, rev: 1, updatedAt: "now" });
  writer.updateEntry.mockResolvedValue({ ok: true, rev: 4, unchanged: false });
  writer.publishEntry.mockResolvedValue({
    ok: true,
    rev: 4,
    publishedAt: "2026-11-26T10:00:00Z",
    ...place,
  });
  writer.unpublishEntry.mockResolvedValue({ ok: true, rev: 4, ...place });
  writer.trashEntry.mockResolvedValue({ ok: true, rev: 4, ...place });
  writer.restoreEntry.mockResolvedValue({ ok: true, rev: 4, ...place });
  writer.listEntries.mockResolvedValue({ ok: true, items: [], nextCursor: null });
  writer.enableType.mockResolvedValue({ ok: true, ...TYPE });
  writer.updateType.mockResolvedValue({ ok: true, ...TYPE });
  const term = {
    id: TERM_A,
    typeId: TYPE_A,
    taxonomy: "tag",
    name: "A tag",
    slug: "a-tag",
    parentId: null,
  };
  writer.createTerm.mockResolvedValue({ ok: true, ...term });
  writer.renameTerm.mockResolvedValue({ ok: true, ...term });
  writer.deleteTerm.mockResolvedValue({ ok: true, id: TERM_A, typeId: TYPE_A });
  writer.listRevisions.mockResolvedValue({ ok: true, revisions: [] });
  writer.restoreRevision.mockResolvedValue({ ok: true, rev: 4, unchanged: false });
  writer.listTypes.mockResolvedValue({ ok: true, types: [TYPE] });
  writer.listTerms.mockResolvedValue({ ok: true, terms: [] });
  writer.countEntries.mockResolvedValue({ ok: true, count: 0 });
  writer.checkPostBody.mockResolvedValue(null);
  gate.publishPageCore.mockResolvedValue({ ok: true, publishedAt: "2026-11-26T10:00:00Z" });
  gate.publishSitePageCore.mockResolvedValue({
    ok: true,
    publishedAt: "2026-11-26T10:00:00Z",
    rev: 4,
    unchanged: false,
  });
  gate.publishDesignCore.mockResolvedValue({ ok: true, publishedAt: "2026-11-26T10:00:00Z" });
}
const reached = () =>
  [...Object.entries(writer), ...Object.entries(gate)]
    .filter(([, spy]) => spy.mock.calls.length > 0)
    .map(([name]) => name);

beforeEach(() => {
  for (const spy of [...Object.values(writer), ...Object.values(gate), cache.invalidatePage]) {
    spy.mockReset();
  }
  allowEverything();
});

describe("the scope of every tool", () => {
  it("exactly these seven tools are behind the publish scope, and nothing else changes the live site", () => {
    expect(
      TOOLS.filter((tool) => tool.scope === MCP_SCOPES.publish).map((tool) => tool.name),
    ).toEqual(PUBLISH_SCOPE_TOOL_NAMES);
    // Every tool whose name says publish is among them.
    for (const tool of TOOLS.filter((item) => /publish/.test(item.name))) {
      expect(tool.scope, tool.name).toBe(MCP_SCOPES.publish);
    }
    // A tool marked as changing the live site is always behind the publish scope.
    for (const tool of TOOLS.filter((item) => item.changesLive || item.publishesSite)) {
      expect(tool.scope, tool.name).toBe(MCP_SCOPES.publish);
    }
  });

  it("the seventeen content tools: five reads, six draft writes, six behind publish", () => {
    const scopeOf = (name: string) => toolByName(name)!.scope;
    const by = (scope: string) => CONTENT_TOOL_NAMES.filter((name) => scopeOf(name) === scope);
    expect(by(MCP_SCOPES.read)).toEqual([
      "list_content_types",
      "list_entries",
      "get_entry",
      "list_terms",
      "list_revisions",
    ]);
    expect(by(MCP_SCOPES.write)).toEqual([
      "create_entry",
      "update_entry",
      "delete_entry",
      "restore_entry",
      "create_term",
      "restore_revision",
    ]);
    expect(by(MCP_SCOPES.publish)).toEqual([
      "rename_term",
      "delete_term",
      "publish_entry",
      "unpublish_entry",
      "publish_design",
      "update_content_type",
    ]);
  });

  it("a read and write token gets insufficient_scope on every publish-scope tool, before the limiter and before any read", async () => {
    for (const name of PUBLISH_SCOPE_TOOL_NAMES) {
      const { deps, calls } = makeDeps();
      const input = CONTENT_TOOL_INPUTS[name] ?? { pageId: PAGE_A };
      const result = await runTool(
        toolByName(name)!,
        identity({ scopes: READ_WRITE }),
        input,
        deps,
      );
      expect(result.isError, name).toBe(true);
      expect(failure(result), name).toMatchObject({
        code: "insufficient_scope",
        requiredScope: "hydlnk.publish",
      });
      expect(failure(result).message, name).toContain("Publish your pages and posts");
      expect((result._meta as any)["mcp/www_authenticate"][0], name).toContain(
        'scope="hydlnk.publish"',
      );
      // Not the limiter, not the account, not a site, not an entry.
      expect(calls, name).toEqual([]);
    }
    expect(reached()).toEqual([]);
    expect(cache.invalidatePage).not.toHaveBeenCalled();
  });

  it("a read-only token is refused on every write and publish tool, and reads nothing", async () => {
    for (const tool of TOOLS.filter((item) => item.scope !== MCP_SCOPES.read)) {
      const { deps, calls } = makeDeps();
      const input = CONTENT_TOOL_INPUTS[tool.name] ?? { pageId: PAGE_A };
      const result = await runTool(tool, identity({ scopes: READ }), input, deps);
      expect(failure(result), tool.name).toMatchObject({
        code: "insufficient_scope",
        requiredScope: tool.scope,
      });
      expect(calls, tool.name).toEqual([]);
    }
    expect(reached()).toEqual([]);
  });

  it("a scope is itself and nothing more: publish does not include write, write does not include read", async () => {
    const run = async (name: string, scopes: string[]) => {
      const { deps } = makeDeps();
      const result = await runTool(
        toolByName(name)!,
        identity({ scopes }),
        CONTENT_TOOL_INPUTS[name],
        deps,
      );
      return result.isError ? failure(result).code : "ok";
    };
    expect(await run("update_entry", [MCP_SCOPES.publish])).toBe("insufficient_scope");
    expect(await run("get_entry", [MCP_SCOPES.write, MCP_SCOPES.publish])).toBe(
      "insufficient_scope",
    );
    expect(await run("publish_entry", [MCP_SCOPES.publish])).toBe("ok");
    expect(await run("create_term", [MCP_SCOPES.write])).toBe("ok");
    expect(await run("list_terms", [MCP_SCOPES.read])).toBe("ok");
  });

  it("a token whose scopes hold an unknown word, a look-alike or nothing gets nothing from it", async () => {
    for (const scopes of [
      ["hydlnk.admin"],
      ["hydlnk.read", "hydlnk.content", "*"],
      ["hydlnk.publish "],
      ["HYDLNK.PUBLISH"],
      ["hydlnk.read hydlnk.write hydlnk.publish"],
      ["publish"],
      [],
    ]) {
      for (const name of ["update_entry", "publish_entry", "delete_term", "update_content_type"]) {
        const { deps, calls } = makeDeps();
        const result = await runTool(
          toolByName(name)!,
          identity({ scopes }),
          CONTENT_TOOL_INPUTS[name],
          deps,
        );
        expect(failure(result).code, `${name} ${JSON.stringify(scopes)}`).toBe(
          "insufficient_scope",
        );
        expect(calls).toEqual([]);
      }
    }
    expect(reached()).toEqual([]);
  });

  it("the token decides, not the grant: a refresh narrowed to read cannot write, whatever the grant once held", async () => {
    // What the endpoint hands over for a token minted by a refresh narrowed to read: the scopes of
    // the token's own row. The grant's id is the same grant that once issued write and publish.
    const who = identityOf({
      token: "t",
      clientId: "hlc_" + "a".repeat(32),
      scopes: ["hydlnk.read"],
      extra: { userId: USER_A, grantId: "33333333-3333-4333-8333-333333333333", tokenId: "tok-2" },
    } as never)!;
    expect(who.scopes).toEqual(["hydlnk.read"]);
    for (const name of ["update_entry", "create_entry", "delete_entry", "publish_entry"]) {
      const { deps, calls } = makeDeps();
      const result = await runTool(toolByName(name)!, who, CONTENT_TOOL_INPUTS[name], deps);
      expect(failure(result).code, name).toBe("insufficient_scope");
      expect(calls).toEqual([]);
    }
    const { deps } = makeDeps();
    const read = await runTool(
      toolByName("list_terms")!,
      who,
      CONTENT_TOOL_INPUTS.list_terms,
      deps,
    );
    expect(read.isError).toBeUndefined();
    expect(reached()).toEqual(["listTerms"]);
  });
});

describe("delete_entry: the publish scope is asked for at run time, only for a live post", () => {
  const input = { entryId: ENTRY_A, ifRev: 3 };

  it("a draft post is trashed with read and write", async () => {
    const { deps } = makeDeps();
    const result = await runTool(
      toolByName("delete_entry")!,
      identity({ scopes: READ_WRITE }),
      input,
      deps,
    );
    expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
    expect(writer.trashEntry).toHaveBeenCalledTimes(1);
  });

  it("a live post with read and write is insufficient_scope with the step-up challenge, and the writer is never reached", async () => {
    const { deps } = makeDeps({
      loadEntry: async (_user, id) => ({
        ok: true,
        entry: ownedEntry({ id, status: "published", publishedAt: "2026-11-01T00:00:00Z" }),
      }),
    });
    const result = await runTool(
      toolByName("delete_entry")!,
      identity({ scopes: READ_WRITE }),
      input,
      deps,
    );
    expect(failure(result)).toMatchObject({
      code: "insufficient_scope",
      requiredScope: "hydlnk.publish",
    });
    expect((result._meta as any)["mcp/www_authenticate"][0]).toContain('scope="hydlnk.publish"');
    expect(reached()).toEqual([]);
    // With publish as well it goes through.
    const allowed = await runTool(toolByName("delete_entry")!, identity(), input, deps);
    expect(allowed.isError).toBeUndefined();
    expect(writer.trashEntry).toHaveBeenCalledTimes(1);
  });

  it("the registry advertises write for it, so a client with write can call it for drafts", () => {
    expect(toolByName("delete_entry")!.scope).toBe(MCP_SCOPES.write);
  });
});

describe("publish_entry routes a page to the Publish gate and a post to the writer", () => {
  it("a post: the writer's publishEntry with the token's user, the source mcp and the ifRev as sent; the gate is never called", async () => {
    const { deps } = makeDeps();
    const result = await runTool(
      toolByName("publish_entry")!,
      identity({ userId: USER_B }),
      { entryId: ENTRY_A, ifRev: 3 },
      deps,
    );
    expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
    expect(writer.publishEntry).toHaveBeenCalledTimes(1);
    expect(writer.publishEntry.mock.calls[0]![0]).toEqual({
      actor: { userId: USER_B, source: "mcp" },
      entryId: ENTRY_A,
      expectedRev: 3,
    });
    expect(gate.publishSitePageCore).not.toHaveBeenCalled();
    expect(gate.publishPageCore).not.toHaveBeenCalled();
    expect(gate.publishDesignCore).not.toHaveBeenCalled();
    // The writer's wrapper expires the post's tags itself: the tool expires nothing of the site.
    expect(cache.invalidatePage).not.toHaveBeenCalled();
  });

  it("a page: the gate's publishSitePageCore with the site, the entry, the ifRev as sent, the token's user and the source mcp; never the writer's publish", async () => {
    const HOME = "4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a";
    const { deps } = makeDeps({
      loadPage: async () => ({ ok: true, page: ownedPage({ homeEntryId: HOME }) }),
      loadEntry: async (_user, id) => ({
        ok: true,
        entry: ownedEntry({ id, typeKey: "page", rev: 9 }),
      }),
    });
    const result = await runTool(
      toolByName("publish_entry")!,
      identity({ userId: USER_B }),
      // ifRev differs from the rev just loaded: it goes to the gate as sent, never replaced.
      { pageId: PAGE_A, ifRev: 7 },
      deps,
    );
    expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
    expect(gate.publishSitePageCore).toHaveBeenCalledTimes(1);
    const [input, gateDeps] = gate.publishSitePageCore.mock.calls[0]!;
    expect(input).toEqual({
      pageId: PAGE_A,
      entryId: HOME,
      expectedRev: 7,
      userId: USER_B,
      source: "mcp",
    });
    expect(Object.keys(gateDeps)).toEqual(["admin"]);
    expect(writer.publishEntry).not.toHaveBeenCalled();
    expect(cache.invalidatePage).toHaveBeenCalledTimes(1);
    expect(cache.invalidatePage).toHaveBeenCalledWith(PAGE_A);
    expect(JSON.stringify(result)).not.toContain(HOME);
  });

  it("a page entry named by entryId goes to the gate too", async () => {
    const { deps } = makeDeps({
      loadEntry: async (_user, id) => ({ ok: true, entry: ownedEntry({ id, typeKey: "page" }) }),
    });
    await runTool(toolByName("publish_entry")!, identity(), { entryId: ENTRY_A, ifRev: 3 }, deps);
    expect(gate.publishSitePageCore).toHaveBeenCalledTimes(1);
    expect(writer.publishEntry).not.toHaveBeenCalled();
  });

  it("a refusal of the gate or of the writer expires nothing", async () => {
    gate.publishSitePageCore.mockResolvedValue({
      ok: false,
      errors: [],
      reason: "conflict",
      currentRev: 12,
    });
    const page = makeDeps({
      loadEntry: async (_user, id) => ({ ok: true, entry: ownedEntry({ id, typeKey: "page" }) }),
    });
    const a = await runTool(
      toolByName("publish_entry")!,
      identity(),
      { entryId: ENTRY_A, ifRev: 3 },
      page.deps,
    );
    expect(failure(a).code).toBe("conflict");
    expect(JSON.stringify(a)).not.toContain("12");
    writer.publishEntry.mockResolvedValue({
      ok: false,
      status: 409,
      error: "conflict",
      message: "x",
      currentRev: 12,
    });
    const b = await runTool(
      toolByName("publish_entry")!,
      identity(),
      { entryId: ENTRY_A, ifRev: 3 },
      makeDeps().deps,
    );
    expect(failure(b)).toEqual({
      code: "conflict",
      message: "This changed while I was working on it. Call get_entry again and redo the change.",
    });
    expect(cache.invalidatePage).not.toHaveBeenCalled();
  });
});

describe("what the writer is handed", () => {
  it("every content tool acts as the token's user with the source mcp, and a write passes the ifRev as sent", async () => {
    for (const name of CONTENT_TOOL_NAMES) {
      for (const spy of [...Object.values(writer), ...Object.values(gate)]) spy.mockClear();
      const { deps } = makeDeps({
        loadEntry: async (_user, id, options) => ({
          ok: true,
          entry: ownedEntry({
            id,
            typeKey: "post",
            status: options.trashed === "yes" ? "trashed" : "draft",
            draft: { title: "T", slug: "t", body: "Body" },
          }),
        }),
      });
      const result = await runTool(
        toolByName(name)!,
        identity({ userId: USER_B }),
        CONTENT_TOOL_INPUTS[name],
        deps,
      );
      expect(
        result.isError,
        `${name}: ${JSON.stringify(result.structuredContent)}`,
      ).toBeUndefined();
      for (const [fn, spy] of Object.entries(writer)) {
        for (const [input] of spy.mock.calls) {
          expect(input.actor, `${name} -> ${fn}`).toEqual({ userId: USER_B, source: "mcp" });
          if ("expectedRev" in input) expect(input.expectedRev, `${name} -> ${fn}`).toBe(3);
          if ("siteId" in input) expect(input.siteId, `${name} -> ${fn}`).toBe(PAGE_A);
        }
      }
      for (const spy of Object.values(gate)) {
        for (const [input] of spy.mock.calls) expect(input.userId, name).toBe(USER_B);
      }
    }
  });

  it("a post tool whose ifRev is not the rev just loaded answers conflict at once: the writer is never handed a rev the client did not send", async () => {
    for (const name of [
      "update_entry",
      "delete_entry",
      "restore_entry",
      "unpublish_entry",
      "publish_entry",
    ]) {
      for (const spy of Object.values(writer)) spy.mockClear();
      const { deps } = makeDeps({
        loadEntry: async (_user, id, options) => ({
          ok: true,
          entry: ownedEntry({
            id,
            rev: 8,
            status: options.trashed === "yes" ? "trashed" : "draft",
            draft: { title: "T", slug: "t", body: "Body" },
          }),
        }),
      });
      const result = await runTool(toolByName(name)!, identity(), CONTENT_TOOL_INPUTS[name], deps);
      expect(failure(result), name).toEqual({
        code: "conflict",
        message:
          "This changed while I was working on it. Call get_entry again and redo the change.",
      });
      expect(JSON.stringify(result), name).not.toContain("8");
      for (const fn of [
        "updateEntry",
        "trashEntry",
        "restoreEntry",
        "unpublishEntry",
        "publishEntry",
      ] as const) {
        expect(writer[fn], `${name} -> ${fn}`).not.toHaveBeenCalled();
      }
    }
  });
});
