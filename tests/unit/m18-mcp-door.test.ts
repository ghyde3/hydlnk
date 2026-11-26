/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ENTRY_A,
  METADATA_URL,
  PAGE_A,
  USER_A,
  USER_B,
  identity,
  makeDeps,
  ownedEntry,
  ownedPage,
} from "./support/mcp-fakes";
import {
  CHANGES_LIVE_TOOL_NAMES,
  CONTENT_TOOL_INPUTS,
  CONTENT_TOOL_NAMES,
  ENTRY_TOOL_NAMES,
} from "./support/mcp-content";

/**
 * M18-01: the door for entry tools. `runTool` resolves an entry under the token's user before the
 * handler runs, in the pinned order, and everything the tool may not work on is one `not_found`.
 * No database: every dependency is a spy, and the content writer and the Publish gate are mocks, so
 * each test can say what was NOT reached.
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
    "postDraftIssues",
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
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));
vi.mock("@/lib/content", () => writer);
vi.mock("@/lib/publish/core", () => gate);
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage: vi.fn() }));
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly: vi.fn() }));

const { runTool } = await import("@/lib/mcp/run-tool");
const { toolByName } = await import("@/lib/mcp/tools");
const { MESSAGES } = await import("@/lib/mcp/errors");
const { requirePublish } = await import("@/lib/mcp/tools/content-common");
const { MCP_ITEM_PUBLISH_PER_HOUR, MCP_PUBLISH_PER_HOUR } = await import("@/lib/mcp/constants");
import type { AnyToolDefinition } from "@/lib/mcp/types";

const ENTRY_NOT_FOUND = { code: "not_found", message: MESSAGES.entry_not_found };
const PAGE_NOT_FOUND = { code: "not_found", message: MESSAGES.not_found };
const failure = (result: any) => result.structuredContent.error as Record<string, any>;
const untouched = () => {
  for (const spy of [...Object.values(writer), ...Object.values(gate)]) {
    expect(spy).not.toHaveBeenCalled();
  }
};

/** A test tool in the entry mode; the handler records that it ran. */
function entryTool(over: Partial<AnyToolDefinition> = {}, handler = vi.fn()): AnyToolDefinition {
  handler.mockResolvedValue({ sentence: "Done.", data: { value: 1 } });
  return {
    name: "update_entry",
    title: "Test",
    description: "Test tool.",
    scope: "hydlnk.write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    input: z.strictObject({
      entryId: z.string().optional(),
      pageId: z.string().optional(),
      subPageId: z.string().optional(),
      n: z.number().int().optional(),
    }),
    page: "entry",
    entryTypes: ["post"],
    handler,
    ...over,
  } as AnyToolDefinition;
}

beforeEach(() => {
  for (const spy of [...Object.values(writer), ...Object.values(gate)]) spy.mockReset();
});

describe("M18-01 the order of the checks in the entry mode", () => {
  it("scope, rate limits, suspension, input, entry, its site, the publish limit, handler, activity", async () => {
    const order: string[] = [];
    const { deps, flush } = makeDeps({
      limit: async (key) => {
        order.push(`limit ${key.split(":")[0]}`);
        return { allowed: true, retryAfter: 0 };
      },
      isSuspended: async () => {
        order.push("suspended");
        return false;
      },
      loadEntry: async (_user, id) => {
        order.push("entry");
        return { ok: true, entry: ownedEntry({ id }) };
      },
      loadPage: async () => {
        order.push("page");
        return { ok: true, page: ownedPage() };
      },
      recordActivity: async () => {
        order.push("activity");
      },
    });
    const handler = vi.fn(async () => {
      order.push("handler");
      return { sentence: "Done.", data: {} };
    });
    const tool = entryTool({ changesLive: true, scope: "hydlnk.publish" });
    tool.handler = handler as never;
    const result = await runTool(tool, identity(), { entryId: ENTRY_A }, deps);
    expect(result.isError).toBeUndefined();
    expect(order).toEqual([
      "limit mcp",
      "limit mcp",
      "limit mcp-token",
      "suspended",
      "entry",
      "page",
      "limit mcp-publish-item",
      "handler",
    ]);
    await flush();
    expect(order.at(-1)).toBe("activity");
  });

  it("the handler gets the entry and its site, and the activity row names the entry's site", async () => {
    const { deps, activity, flush } = makeDeps();
    const handler = vi.fn();
    const result = await runTool(entryTool({}, handler), identity(), { entryId: ENTRY_A }, deps);
    expect(result.isError).toBeUndefined();
    const call = handler.mock.calls[0]![1];
    expect(call.entry).toMatchObject({ id: ENTRY_A, siteId: PAGE_A, typeKey: "post" });
    expect(call.page).toMatchObject({ id: PAGE_A });
    expect(call.userId).toBe(USER_A);
    await flush();
    expect(activity).toEqual([
      expect.objectContaining({ tool: "update_entry", pageId: PAGE_A, ok: true, errorCode: null }),
    ]);
  });

  it("hands the lookup the token's user, the tool's types, its trash side and whether a blog that is off is taken", async () => {
    const seen: any[] = [];
    const { deps } = makeDeps({
      loadEntry: async (userId, entryId, options) => {
        seen.push({ userId, entryId, options });
        return { ok: true, entry: ownedEntry({ id: entryId }) };
      },
    });
    await runTool(entryTool(), identity({ userId: USER_B }), { entryId: ENTRY_A }, deps);
    await runTool(
      entryTool({
        entryTypes: ["post", "page"],
        entryTrash: "any",
        allowDisabledType: true,
        needsDraft: true,
      }),
      identity(),
      { entryId: ENTRY_A },
      deps,
    );
    expect(seen).toEqual([
      {
        userId: USER_B,
        entryId: ENTRY_A,
        options: { types: ["post"], trashed: "no", allowDisabledType: false, withDraft: false },
      },
      {
        userId: USER_A,
        entryId: ENTRY_A,
        options: {
          types: ["post", "page"],
          trashed: "any",
          allowDisabledType: true,
          withDraft: true,
        },
      },
    ]);
  });

  it("a suspended account is refused before any read of an entry or a site", async () => {
    const handler = vi.fn();
    const { deps, calls } = makeDeps({
      isSuspended: async () => {
        calls.push("suspended");
        return true;
      },
    });
    const result = await runTool(entryTool({}, handler), identity(), { entryId: ENTRY_A }, deps);
    expect(failure(result).code).toBe("account_suspended");
    expect(calls.filter((call) => call === "entry" || call === "page")).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("a rate-limited call reads no account and no entry", async () => {
    const { deps, calls } = makeDeps({
      limit: async () => ({ allowed: false, retryAfter: 12 }),
    });
    const result = await runTool(entryTool(), identity(), { entryId: ENTRY_A }, deps);
    expect(failure(result)).toMatchObject({ code: "rate_limited", retryAfterSeconds: 12 });
    expect(calls).toEqual([]);
  });

  it("a bad input is refused before the entry is read", async () => {
    const { deps, calls } = makeDeps();
    const result = await runTool(entryTool(), identity(), { entryId: ENTRY_A, n: "x" }, deps);
    expect(failure(result).code).toBe("invalid_input");
    expect(calls.filter((call) => call === "entry" || call === "page")).toEqual([]);
  });
});

describe("M18-01 everything an entry tool may not work on is one not_found", () => {
  it("whatever the entry lookup refuses for, the answer is the same object and the handler never runs", async () => {
    const handler = vi.fn();
    const answers: unknown[] = [];
    // Another account's entry, a type the tool does not take, the wrong side of the trash, a random
    // id and a malformed id all leave the lookup as this one refusal.
    for (const entryId of [ENTRY_A, "not-a-uuid", "", "00000000-0000-4000-8000-000000000000"]) {
      const { deps, calls } = makeDeps({
        loadEntry: async () => {
          calls.push("entry");
          return { ok: false, failure: { code: "not_found", message: MESSAGES.entry_not_found } };
        },
      });
      const result = await runTool(
        entryTool({ changesLive: true }, handler),
        identity(),
        { entryId },
        deps,
      );
      answers.push(failure(result));
      // The site is never read, and the publish limit is never counted.
      expect(calls.filter((call) => call === "page")).toEqual([]);
      expect(calls.filter((call) => call.startsWith("limit:mcp-publish"))).toEqual([]);
    }
    for (const answer of answers) expect(answer).toEqual(ENTRY_NOT_FOUND);
    expect(handler).not.toHaveBeenCalled();
  });

  it("an entry of the caller's other site sent with a different pageId is the same not_found", async () => {
    const OTHER_SITE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const handler = vi.fn();
    const { deps } = makeDeps({
      loadEntry: async (_user, id) => ({ ok: true, entry: ownedEntry({ id, siteId: PAGE_A }) }),
      // The caller owns both sites: the lookup of the pageId succeeds, and it is the other site.
      loadPage: async (_user, pageId) => ({ ok: true, page: ownedPage({ id: pageId! }) }),
    });
    const result = await runTool(
      entryTool({ changesLive: true }, handler),
      identity(),
      { entryId: ENTRY_A, pageId: OTHER_SITE },
      deps,
    );
    expect(failure(result)).toEqual(ENTRY_NOT_FOUND);
    expect(handler).not.toHaveBeenCalled();
    // With the entry's own site as pageId the call goes through.
    const fine = await runTool(
      entryTool({}, handler),
      identity(),
      { entryId: ENTRY_A, pageId: PAGE_A },
      deps,
    );
    expect(fine.isError).toBeUndefined();
  });

  it("a pageId that is not the caller's, sent with an entry that is, is the same not_found", async () => {
    const handler = vi.fn();
    const { deps } = makeDeps({
      loadPage: async (_user, pageId) =>
        pageId === PAGE_A
          ? { ok: true, page: ownedPage() }
          : { ok: false, failure: { ...PAGE_NOT_FOUND } as never },
    });
    const result = await runTool(
      entryTool({}, handler),
      identity(),
      { entryId: ENTRY_A, pageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      deps,
    );
    expect(failure(result)).toEqual(ENTRY_NOT_FOUND);
    expect(handler).not.toHaveBeenCalled();
  });

  it("entryId together with subPageId is invalid_input, and a post tool without entryId says it is required", async () => {
    const handler = vi.fn();
    const { deps, calls } = makeDeps();
    const both = await runTool(
      entryTool({ entryTypes: ["post", "page"] }, handler),
      identity(),
      { entryId: ENTRY_A, subPageId: "5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b" },
      deps,
    );
    expect(failure(both)).toMatchObject({
      code: "invalid_input",
      message: MESSAGES.entryIdWithSubPage,
    });
    const none = await runTool(entryTool({}, handler), identity(), {}, deps);
    expect(failure(none)).toMatchObject({
      code: "invalid_input",
      message: "entryId is required. Call list_entries.",
      issues: [{ path: "entryId", message: "entryId is required. Call list_entries." }],
    });
    expect(calls.filter((call) => call === "entry" || call === "page")).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("a read failure of the lookup is a server_error that says nothing of it", async () => {
    const { deps } = makeDeps({
      loadEntry: async () => {
        throw new Error("relation content_entries exploded at 10.0.0.7");
      },
    });
    const result = await runTool(entryTool(), identity(), { entryId: ENTRY_A }, deps);
    expect(failure(result)).toEqual({ code: "server_error", message: MESSAGES.serverError });
    expect(JSON.stringify(result)).not.toContain("exploded");
  });
});

describe("M18-01 a tool that takes pages reaches a page by pageId and subPageId", () => {
  const SUB = "5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b";
  const HOME = "4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a";
  const pageTool = (handler = vi.fn()) => entryTool({ entryTypes: ["post", "page"] }, handler);

  it("Home when no sub-page is named: Home's own entry, looked up as a page", async () => {
    const seen: any[] = [];
    const handler = vi.fn();
    const { deps } = makeDeps({
      loadPage: async () => ({ ok: true, page: ownedPage({ homeEntryId: HOME, homeRev: 7 }) }),
      loadEntry: async (_user, id, options) => {
        seen.push({ id, types: options.types });
        return { ok: true, entry: ownedEntry({ id, typeKey: "page", rev: 7 }) };
      },
    });
    const result = await runTool(pageTool(handler), identity(), { pageId: PAGE_A }, deps);
    expect(result.isError).toBeUndefined();
    expect(seen).toEqual([{ id: HOME, types: ["page"] }]);
    expect(handler.mock.calls[0]![1].entry).toMatchObject({ id: HOME, typeKey: "page" });
  });

  it("a sub-page by subPageId: looked up under the site first, then as a page entry", async () => {
    const seen: string[] = [];
    const handler = vi.fn();
    const { deps, calls } = makeDeps({
      loadEntry: async (_user, id, options) => {
        seen.push(`${id}:${options.types.join(",")}`);
        return { ok: true, entry: ownedEntry({ id, typeKey: "page" }) };
      },
    });
    const result = await runTool(
      pageTool(handler),
      identity(),
      { pageId: PAGE_A, subPageId: SUB },
      deps,
    );
    expect(result.isError).toBeUndefined();
    expect(calls.filter((call) => call === "page" || call === "subpage")).toEqual([
      "page",
      "subpage",
    ]);
    expect(seen).toEqual([`${SUB}:page`]);
  });

  it("a sub-page of another site or account, and a site with no Home entry, are the entry not_found", async () => {
    const handler = vi.fn();
    const foreign = makeDeps({
      loadSubPage: async () => ({ ok: false, failure: { ...PAGE_NOT_FOUND } as never }),
    });
    const a = await runTool(
      pageTool(handler),
      identity(),
      { pageId: PAGE_A, subPageId: SUB },
      foreign.deps,
    );
    expect(failure(a)).toEqual(ENTRY_NOT_FOUND);
    const noSite = makeDeps({
      loadPage: async () => ({ ok: false, failure: { ...PAGE_NOT_FOUND } as never }),
    });
    const b = await runTool(pageTool(handler), identity(), { pageId: PAGE_A }, noSite.deps);
    expect(failure(b)).toEqual(ENTRY_NOT_FOUND);
    // No Home entry (a site that was never moved): nothing to work on.
    const c = await runTool(pageTool(handler), identity(), { pageId: PAGE_A }, makeDeps().deps);
    expect(failure(c)).toEqual(ENTRY_NOT_FOUND);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("M18-01 the publish limits", () => {
  it("a tool marked as changing the live site counts 60 an hour per person, across tokens", async () => {
    const seen: Array<[string, number, number]> = [];
    const { deps } = makeDeps({
      limit: async (key, limit, window) => {
        seen.push([key, limit, window]);
        return { allowed: true, retryAfter: 0 };
      },
    });
    const tool = entryTool({ changesLive: true, scope: "hydlnk.publish" });
    await runTool(tool, identity({ tokenId: "t-1" }), { entryId: ENTRY_A }, deps);
    await runTool(tool, identity({ tokenId: "t-2" }), { entryId: ENTRY_A }, deps);
    const item = seen.filter(([key]) => key.startsWith("mcp-publish-item:"));
    // One key for the person, whichever token called.
    expect(item).toEqual([
      [`mcp-publish-item:${USER_A}`, 60, 3600],
      [`mcp-publish-item:${USER_A}`, 60, 3600],
    ]);
    expect(MCP_ITEM_PUBLISH_PER_HOUR).toBe(60);
    // It never counts against publish_page's own limit.
    expect(seen.some(([key]) => key.startsWith("mcp-publish:"))).toBe(false);
  });

  it("over the limit the call is rate_limited with retryAfterSeconds and the handler never runs", async () => {
    const handler = vi.fn();
    const { deps } = makeDeps({
      limit: async (key) =>
        key.startsWith("mcp-publish-item:")
          ? { allowed: false, retryAfter: 1800.2 }
          : { allowed: true, retryAfter: 0 },
    });
    const result = await runTool(
      entryTool({ changesLive: true }, handler),
      identity(),
      { entryId: ENTRY_A },
      deps,
    );
    expect(failure(result)).toMatchObject({ code: "rate_limited", retryAfterSeconds: 1801 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("the real tools: the six per-item tools carry the mark, and publish_page keeps its 10 an hour", async () => {
    for (const name of CONTENT_TOOL_NAMES) {
      expect(toolByName(name)!.changesLive === true, name).toBe(
        CHANGES_LIVE_TOOL_NAMES.includes(name),
      );
      expect(toolByName(name)!.publishesSite, name).toBeUndefined();
    }
    const publishPage = toolByName("publish_page")!;
    expect(publishPage.publishesSite).toBe(true);
    expect(publishPage.changesLive).toBeUndefined();
    expect(MCP_PUBLISH_PER_HOUR).toBe(10);
    gate.publishPageCore.mockResolvedValue({ ok: true, publishedAt: "2026-11-26T10:00:00Z" });
    const seen: Array<[string, number, number]> = [];
    const { deps } = makeDeps({
      limit: async (key, limit, window) => {
        seen.push([key, limit, window]);
        return { allowed: true, retryAfter: 0 };
      },
      admin: {
        from: () => ({
          select: () => ({ in: () => ({ order: async () => ({ data: [], error: null }) }) }),
        }),
      } as never,
    });
    await runTool(publishPage, identity(), { pageId: PAGE_A }, deps);
    expect(seen.at(-1)).toEqual([`mcp-publish:${USER_A}`, 10, 3600]);
    expect(seen.some(([key]) => key.startsWith("mcp-publish-item:"))).toBe(false);
  });
});

describe("M18-01 delete_entry on a live post draws on the per-item bucket", () => {
  const trashed = { ok: true, rev: 4, siteId: PAGE_A, typeId: "t", typeKey: "post" };
  const live = (status: "published" | "draft", allowed = true) => {
    const seen: string[] = [];
    const { deps } = makeDeps({
      limit: async (key) => {
        seen.push(key);
        return key.startsWith("mcp-publish-item:")
          ? { allowed, retryAfter: allowed ? 0 : 900 }
          : { allowed: true, retryAfter: 0 };
      },
      loadEntry: async (_user, id) => ({ ok: true, entry: ownedEntry({ id, status }) }),
    });
    return { deps, seen };
  };

  it("a live post counts once against the bucket; a draft post does not", async () => {
    writer.trashEntry.mockResolvedValue(trashed);
    const tool = toolByName("delete_entry")!;
    const one = live("published");
    expect((await runTool(tool, identity(), { entryId: ENTRY_A, ifRev: 3 }, one.deps)).isError)
      .toBeUndefined();
    expect(one.seen.filter((key) => key === `mcp-publish-item:${USER_A}`)).toHaveLength(1);
    const two = live("draft");
    expect((await runTool(tool, identity(), { entryId: ENTRY_A, ifRev: 3 }, two.deps)).isError)
      .toBeUndefined();
    expect(two.seen.some((key) => key.startsWith("mcp-publish-item:"))).toBe(false);
  });

  it("over the bucket a live post is rate_limited and stays live: the writer is never called", async () => {
    const tool = toolByName("delete_entry")!;
    const { deps } = live("published", false);
    const result = await runTool(tool, identity(), { entryId: ENTRY_A, ifRev: 3 }, deps);
    expect(failure(result)).toMatchObject({ code: "rate_limited", retryAfterSeconds: 900 });
    expect(writer.trashEntry).not.toHaveBeenCalled();
    // A draft post is trashed at the same moment: the bucket is for what visitors see.
    writer.trashEntry.mockResolvedValue(trashed);
    const draft = live("draft", false);
    expect((await runTool(tool, identity(), { entryId: ENTRY_A, ifRev: 3 }, draft.deps)).isError)
      .toBeUndefined();
  });
});

describe("M18-01 a handler can demand the publish scope on top of its tool's", () => {
  it("the refusal is insufficient_scope with requiredScope and the step-up challenge", async () => {
    const wrote = vi.fn();
    const tool = entryTool();
    tool.handler = (async (_args: unknown, call: any) => {
      requirePublish(call);
      wrote();
      return { sentence: "Done.", data: {} };
    }) as never;
    const { deps } = makeDeps();
    const result = await runTool(
      tool,
      identity({ scopes: ["hydlnk.read", "hydlnk.write"] }),
      { entryId: ENTRY_A },
      deps,
    );
    expect(result.isError).toBe(true);
    expect(failure(result)).toMatchObject({
      code: "insufficient_scope",
      requiredScope: "hydlnk.publish",
    });
    expect(failure(result).message).toContain("Publish your pages and posts");
    const challenge = (result._meta as Record<string, string[]>)["mcp/www_authenticate"]!;
    expect(challenge[0]).toContain('scope="hydlnk.publish"');
    expect(challenge[0]).toContain(`resource_metadata="${METADATA_URL}"`);
    expect(wrote).not.toHaveBeenCalled();
    // With the scope the same handler goes on.
    const fine = await runTool(tool, identity(), { entryId: ENTRY_A }, deps);
    expect(fine.isError).toBeUndefined();
    expect(wrote).toHaveBeenCalledTimes(1);
  });
});

describe("M18-01 the seventeen content tools at the door", () => {
  it("there are seventeen, and the eight entry tools are in the entry mode", () => {
    expect(CONTENT_TOOL_NAMES).toHaveLength(17);
    for (const name of CONTENT_TOOL_NAMES) {
      const tool = toolByName(name);
      expect(tool, name).toBeDefined();
      expect(tool!.page, name).toBe(ENTRY_TOOL_NAMES.includes(name) ? "entry" : "one");
    }
  });

  it("the user is always the token's: userId, ownerId and siteOwner fail as unknown fields on every one", async () => {
    for (const name of CONTENT_TOOL_NAMES) {
      for (const extra of ["userId", "ownerId", "siteOwner"]) {
        const { deps, calls } = makeDeps();
        const result = await runTool(
          toolByName(name)!,
          identity(),
          { ...CONTENT_TOOL_INPUTS[name], [extra]: USER_B },
          deps,
        );
        expect(failure(result).code, `${name} ${extra}`).toBe("invalid_input");
        expect(failure(result).message, `${name} ${extra}`).toContain(`Unknown field “${extra}”`);
        expect(calls.filter((call) => call === "entry" || call === "page")).toEqual([]);
      }
    }
    untouched();
  });

  it("another account's ids are not_found on all seventeen: no handler, no writer, no gate, no publish limit", async () => {
    for (const name of CONTENT_TOOL_NAMES) {
      const tool = toolByName(name)!;
      // User B's token with user A's site and entry: both lookups refuse, as the real ones do.
      const { deps, calls } = makeDeps({
        loadPage: async () => {
          calls.push("page");
          return { ok: false, failure: { ...PAGE_NOT_FOUND } as never };
        },
        loadEntry: async () => {
          calls.push("entry");
          return { ok: false, failure: { ...ENTRY_NOT_FOUND } as never };
        },
      });
      const result = await runTool(
        tool,
        identity({ userId: USER_B }),
        CONTENT_TOOL_INPUTS[name],
        deps,
      );
      expect(failure(result), name).toEqual(
        ENTRY_TOOL_NAMES.includes(name) ? ENTRY_NOT_FOUND : PAGE_NOT_FOUND,
      );
      expect(
        calls.filter((call) => call.startsWith("limit:mcp-publish")),
        name,
      ).toEqual([]);
    }
    untouched();
  });

  it("a suspended account is refused on all seventeen before any read", async () => {
    for (const name of CONTENT_TOOL_NAMES) {
      const { deps, calls } = makeDeps({ isSuspended: async () => true });
      const result = await runTool(toolByName(name)!, identity(), CONTENT_TOOL_INPUTS[name], deps);
      expect(failure(result).code, name).toBe("account_suspended");
      expect(calls.filter((call) => call === "entry" || call === "page")).toEqual([]);
    }
    untouched();
  });

  it("the post tools take posts only; the three that take pages say so; restore takes only the trash", () => {
    const types = (name: string) => [...(toolByName(name)!.entryTypes ?? [])].sort();
    for (const name of [
      "get_entry",
      "update_entry",
      "delete_entry",
      "restore_entry",
      "unpublish_entry",
    ]) {
      expect(types(name), name).toEqual(["post"]);
    }
    for (const name of ["publish_entry", "list_revisions", "restore_revision"]) {
      expect(types(name), name).toEqual(["page", "post"]);
    }
    expect(toolByName("restore_entry")!.entryTrash).toBe("yes");
    expect(toolByName("get_entry")!.entryTrash).toBe("any");
    for (const name of ENTRY_TOOL_NAMES.filter(
      (item) => item !== "restore_entry" && item !== "get_entry",
    )) {
      expect(toolByName(name)!.entryTrash ?? "no", name).toBe("no");
    }
    // A blog that is off: only the reads and taking a post down still work on its posts.
    for (const name of ENTRY_TOOL_NAMES) {
      expect(toolByName(name)!.allowDisabledType === true, name).toBe(
        ["get_entry", "list_revisions", "unpublish_entry"].includes(name),
      );
    }
  });
});

describe("M18-05 a limit the database reports reaches the client as a pinned code, whatever was sent", () => {
  const refusal = (error: string) => ({
    ok: false,
    status: 403,
    error,
    message: `WRITER-${error}`,
  });
  const run = (name: string, input: Record<string, unknown>) =>
    runTool(toolByName(name)!, identity(), input, makeDeps({ admin: planAdmin("free") }).deps);
  /** The one read a tool makes for the sentence of a post limit: the account's plan. */
  const planAdmin = (plan: string) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { plan }, error: null }) }),
        }),
      }),
    }) as never;

  beforeEach(() => {
    writer.checkPostBody.mockResolvedValue(null);
    writer.listTerms.mockResolvedValue({ ok: true, terms: [] });
  });

  it("an account at its content bytes is too_large on create_entry and update_entry", async () => {
    writer.createEntry.mockResolvedValue(refusal("storage_full"));
    writer.updateEntry.mockResolvedValue(refusal("storage_full"));
    const created = await run("create_entry", { pageId: PAGE_A, title: "T", body: "x" });
    expect(failure(created).code).toBe("too_large");
    expect(JSON.stringify(created)).not.toContain("WRITER-");
    const updated = await run("update_entry", { entryId: ENTRY_A, ifRev: 3, title: "T" });
    expect(failure(updated).code).toBe("too_large");
    expect(JSON.stringify(updated)).not.toContain("WRITER-");
  });

  it("the post limit is plan_required with the plan's sentence, and a draft over 1 MiB is too_large", async () => {
    writer.createEntry.mockResolvedValue(refusal("entry_limit"));
    const limit = await run("create_entry", { pageId: PAGE_A, title: "T" });
    expect(failure(limit)).toEqual({
      code: "plan_required",
      message: "Free includes 25 posts, the trash included. Pro includes 1,000.",
    });
    writer.createEntry.mockResolvedValue(refusal("too_large"));
    const large = await run("create_entry", { pageId: PAGE_A, title: "T" });
    expect(failure(large)).toEqual({
      code: "too_large",
      message: "That is too large to save. Shorten it and try again.",
    });
  });

  it("the term cap is limit_reached, and a writer failure of its own is server_error with our sentence", async () => {
    writer.createTerm.mockResolvedValue(refusal("term_limit"));
    const term = await run("create_term", { pageId: PAGE_A, taxonomy: "tag", name: "N" });
    expect(failure(term).code).toBe("limit_reached");
    writer.createTerm.mockResolvedValue(refusal("error"));
    const broken = await run("create_term", { pageId: PAGE_A, taxonomy: "tag", name: "N" });
    expect(failure(broken)).toEqual({ code: "server_error", message: MESSAGES.serverError });
    expect(JSON.stringify(broken)).not.toContain("WRITER-");
  });

  it("a handler that throws anything else says nothing of it", async () => {
    writer.createEntry.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.7:5432 sb_secret_x"),
    );
    const out = await run("create_entry", { pageId: PAGE_A, title: "T" });
    expect(failure(out)).toEqual({ code: "server_error", message: MESSAGES.serverError });
    expect(JSON.stringify(out)).not.toMatch(/ECONNREFUSED|sb_secret/);
  });
});
