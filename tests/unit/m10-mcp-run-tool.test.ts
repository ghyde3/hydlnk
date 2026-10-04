import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { METADATA_URL, identity, makeDeps } from "./support/mcp-fakes";

vi.mock("server-only", () => ({}));
// run-tool reads the suspended sentence from the admin module, which would parse the environment.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));

const { runTool } = await import("@/lib/mcp/run-tool");
const { ToolFailure } = await import("@/lib/mcp/errors");
const { TOOL_ERROR_CODES } = await import("@/lib/mcp/errors");
const { MCP_RESULT_MAX_BYTES } = await import("@/lib/mcp/constants");
import type { AnyToolDefinition } from "@/lib/mcp/types";

/**
 * M10-22: every tool call goes through one wrapper, in one order, and nothing a handler throws can
 * reach the client. The dependencies are spies, so each test can say what was NOT touched.
 */

function tool(
  over: Partial<AnyToolDefinition> = {},
  handler?: AnyToolDefinition["handler"],
): AnyToolDefinition {
  return {
    name: "add_block",
    title: "Add a block",
    description: "Test tool.",
    scope: "hydlnk.write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    input: z.strictObject({ pageId: z.string().optional(), n: z.number().int().optional() }),
    page: "one",
    handler: handler ?? (async () => ({ sentence: "Done.", data: { value: 1 } })),
    ...over,
  } as AnyToolDefinition;
}

describe("runTool: the order of the checks", () => {
  it("scope, rate limits, suspension, input, page, handler, activity", async () => {
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
      loadPage: async () => {
        order.push("page");
        return {
          ok: true,
          page: {
            id: "p",
            name: "n",
            handle: "h",
            createdAt: "",
            updatedAt: "",
            publishedAt: null,
          },
        };
      },
      recordActivity: async () => {
        order.push("activity");
      },
    });
    const probe = tool(
      {
        input: z
          .strictObject({ n: z.number() })
          .superRefine(() => void order.push("parse")) as never,
      },
      async () => {
        order.push("handler");
        return { sentence: "ok", data: {} };
      },
    );
    const result = await runTool(probe, identity(), { n: 1 }, deps);
    expect(result.isError).toBeUndefined();
    expect(order).toEqual([
      "limit mcp",
      "limit mcp",
      "limit mcp-token",
      "suspended",
      "parse",
      "page",
      "handler",
    ]);
    await flush();
    expect(order.at(-1)).toBe("activity");
  });

  it("an out-of-scope call never touches the limiter, the account or a page", async () => {
    const { deps, calls } = makeDeps();
    const result = await runTool(
      tool({ name: "publish_page", scope: "hydlnk.publish" }),
      identity({ scopes: ["hydlnk.read", "hydlnk.write"] }),
      {},
      deps,
    );
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("a rate-limited call never reads the account, validates input or reads a page", async () => {
    const { deps, calls } = makeDeps({
      limit: async (key) => {
        calls.push(`limit:${key}`);
        return { allowed: false, retryAfter: 17 };
      },
    });
    const result = await runTool(tool(), identity(), { n: "not a number" }, deps);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "rate_limited", retryAfterSeconds: 17 },
    });
    expect(calls.filter((call) => call === "suspended" || call === "page")).toEqual([]);
  });

  it("a suspended account never reaches validation or a page read", async () => {
    const handler = vi.fn();
    const { deps, calls } = makeDeps({
      isSuspended: async () => {
        calls.push("suspended");
        return true;
      },
    });
    const result = await runTool(tool({ handler: handler as never }), identity(), { n: "x" }, deps);
    expect(result.structuredContent).toMatchObject({ error: { code: "account_suspended" } });
    expect(calls).not.toContain("page");
    expect(handler).not.toHaveBeenCalled();
  });

  it("invalid input never reads a page", async () => {
    const { deps, calls } = makeDeps();
    const result = await runTool(tool(), identity(), { n: "x" }, deps);
    expect(result.structuredContent).toMatchObject({ error: { code: "invalid_input" } });
    expect(calls).not.toContain("page");
  });
});

describe("runTool: scope", () => {
  const publish = tool({ name: "publish_page", scope: "hydlnk.publish" });

  it("a read and write token calling publish_page is insufficient_scope, with the sign-in challenge ChatGPT reads", async () => {
    const { deps } = makeDeps();
    const result = await runTool(
      publish,
      identity({ scopes: ["hydlnk.read", "hydlnk.write"] }),
      {},
      deps,
    );
    expect(result.isError).toBe(true);
    const error = (result.structuredContent as { error: Record<string, unknown> }).error;
    expect(error).toMatchObject({ code: "insufficient_scope", requiredScope: "hydlnk.publish" });
    expect(error.message).toBe(
      "This connection can’t publish your pages. In HYDLNK open Settings, remove this app under Connected apps, then connect it again and allow “Publish your pages”.",
    );
    const challenge = (result._meta as Record<string, string[]>)["mcp/www_authenticate"]!;
    expect(challenge).toHaveLength(1);
    expect(challenge[0]).toMatch(
      new RegExp(
        `^Bearer error="insufficient_scope", scope="hydlnk\\.publish", resource_metadata="${METADATA_URL.replace(/[.]/g, "\\.")}", error_description="[^"]+"$`,
      ),
    );
  });

  it("a read-only token calling add_block is insufficient_scope for hydlnk.write", async () => {
    const { deps } = makeDeps();
    const result = await runTool(tool(), identity({ scopes: ["hydlnk.read"] }), {}, deps);
    expect(result.structuredContent).toMatchObject({
      error: { code: "insufficient_scope", requiredScope: "hydlnk.write" },
    });
    expect((result.structuredContent as { error: { message: string } }).error.message).toContain(
      "Edit your drafts",
    );
  });

  it("a token with the scope runs the tool", async () => {
    const { deps } = makeDeps();
    const result = await runTool(publish, identity(), {}, deps);
    expect(result.isError).toBeUndefined();
  });
});

describe("runTool: rate limits", () => {
  it("counts per person per minute and hour and per token, and publish_page adds its own", async () => {
    const { deps, calls } = makeDeps();
    await runTool(tool(), identity(), {}, deps);
    expect(calls.filter((call) => call.startsWith("limit:"))).toEqual([
      "limit:mcp:11111111-1111-4111-8111-111111111111:min",
      "limit:mcp:11111111-1111-4111-8111-111111111111:hour",
      "limit:mcp-token:44444444-4444-4444-8444-444444444444",
    ]);
    calls.length = 0;
    await runTool(tool({ name: "publish_page", scope: "hydlnk.publish" }), identity(), {}, deps);
    expect(calls.filter((call) => call.startsWith("limit:")).at(-1)).toBe(
      "limit:mcp-publish:11111111-1111-4111-8111-111111111111",
    );
  });

  it("uses the pinned numbers", async () => {
    const seen: Array<[string, number, number]> = [];
    const { deps } = makeDeps({
      limit: async (key, limit, window) => {
        seen.push([key.replace(/[0-9a-f-]{36}/, "ID"), limit, window]);
        return { allowed: true, retryAfter: 0 };
      },
    });
    await runTool(tool({ name: "publish_page", scope: "hydlnk.publish" }), identity(), {}, deps);
    expect(seen).toEqual([
      ["mcp:ID:min", 60, 60],
      ["mcp:ID:hour", 600, 3600],
      ["mcp-token:ID", 30, 60],
      ["mcp-publish:ID", 10, 3600],
    ]);
  });

  it("the 61st call in a minute is rate_limited with the number of seconds", async () => {
    let hits = 0;
    const { deps } = makeDeps({
      limit: async (key) => {
        if (!key.endsWith(":min")) return { allowed: true, retryAfter: 0 };
        hits += 1;
        return hits > 60 ? { allowed: false, retryAfter: 42 } : { allowed: true, retryAfter: 0 };
      },
    });
    for (let call = 1; call <= 60; call++) {
      expect((await runTool(tool(), identity(), {}, deps)).isError).toBeUndefined();
    }
    const blocked = await runTool(tool(), identity(), {}, deps);
    expect(blocked.structuredContent).toMatchObject({
      error: {
        code: "rate_limited",
        retryAfterSeconds: 42,
        message: "You’re going too fast. Try again in 42 seconds.",
      },
    });
  });

  it("a limiter that throws lets the call through and logs it", async () => {
    const { deps, logs } = makeDeps({
      limit: async () => {
        throw new Error("store down");
      },
    });
    const result = await runTool(tool(), identity(), {}, deps);
    expect(result.isError).toBeUndefined();
    expect(logs.some((line) => line.includes("rate limiter failed"))).toBe(true);
  });
});

describe("runTool: input and ownership", () => {
  it("an unknown key fails with its name, and a wrong kind of value says so, never raw zod text", async () => {
    const { deps } = makeDeps();
    const result = await runTool(tool(), identity(), { surprise: 1, n: "x" }, deps);
    const error = (
      result.structuredContent as {
        error: { code: string; issues: Array<{ path: string; message: string }>; message: string };
      }
    ).error;
    expect(error.code).toBe("invalid_input");
    expect(error.issues.some((issue) => issue.message.includes("surprise"))).toBe(true);
    expect(JSON.stringify(error)).not.toMatch(
      /Invalid input|received|too_big|invalid_type|ZodError/i,
    );
    expect(error.issues.some((issue) => /wrong kind of value/.test(issue.message))).toBe(true);
  });

  it("reports at most 10 issues and never echoes more than 80 characters of a value", async () => {
    const { deps } = makeDeps();
    const keys = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`k${"x".repeat(200)}${index}`, 1]),
    );
    const result = await runTool(tool(), identity(), keys, deps);
    const error = (result.structuredContent as { error: { issues: Array<{ message: string }> } })
      .error;
    expect(error.issues.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(error)).not.toContain("x".repeat(100));
  });

  it("a page that is not the caller's is not_found, the handler never runs and the activity row has no page", async () => {
    const handler = vi.fn();
    const { deps, flush, activity } = makeDeps({
      loadPage: async () => ({
        ok: false,
        failure: {
          code: "not_found",
          message: "We couldn’t find that page. Call list_pages to see your pages.",
        },
      }),
    });
    const result = await runTool(
      tool({ handler: handler as never }),
      identity(),
      { pageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      deps,
    );
    expect(result.structuredContent).toMatchObject({ error: { code: "not_found" } });
    expect(handler).not.toHaveBeenCalled();
    await flush();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ pageId: null, ok: false, errorCode: "not_found" });
  });

  it("the handler gets the page the lookup found, and a tool with no page skips the lookup", async () => {
    const seen: unknown[] = [];
    const { deps, calls } = makeDeps();
    await runTool(
      tool({ page: "one" }, async (_args, call) => {
        seen.push(call.page?.id);
        return { sentence: "ok", data: {} };
      }),
      identity(),
      { pageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      deps,
    );
    expect(seen).toEqual(["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
    calls.length = 0;
    await runTool(
      tool({ page: "none", name: "list_pages", scope: "hydlnk.read" }),
      identity(),
      {},
      deps,
    );
    expect(calls).not.toContain("page");
  });
});

describe("runTool: results", () => {
  it("success is one sentence, the same data as compact JSON, and structuredContent with ok", async () => {
    const { deps } = makeDeps();
    const result = await runTool(
      tool({}, async () => ({
        sentence: "Added a link block at position 3.",
        data: { blockId: "abc", n: 2 },
      })),
      identity(),
      {},
      deps,
    );
    expect(result.content).toEqual([
      { type: "text", text: "Added a link block at position 3." },
      { type: "text", text: '{"blockId":"abc","n":2}' },
    ]);
    expect(result.structuredContent).toEqual({ ok: true, blockId: "abc", n: 2 });
    expect(result.isError).toBeUndefined();
  });

  it("a failure is an error result with one sentence and the code in structuredContent", async () => {
    const { deps } = makeDeps();
    const result = await runTool(
      tool({}, async () => {
        throw new ToolFailure(
          "conflict",
          "This page changed while I was working on it. Call get_page again and redo the change.",
        );
      }),
      identity(),
      {},
      deps,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "This page changed while I was working on it. Call get_page again and redo the change.",
      },
    ]);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "conflict",
        message:
          "This page changed while I was working on it. Call get_page again and redo the change.",
      },
    });
  });

  it("the failure codes are exactly the sixteen, pinned", () => {
    expect([...TOOL_ERROR_CODES]).toEqual([
      "invalid_input",
      "not_found",
      "block_not_found",
      "conflict",
      "blocked_link",
      "too_large",
      "block_limit",
      "image_not_found",
      "theme_not_found",
      "plan_required",
      "preview_link_limit",
      "publish_refused",
      "insufficient_scope",
      "rate_limited",
      "account_suspended",
      "server_error",
    ]);
  });

  it("a result over 60 KB shortens long text to 200 characters, marks it and says so", async () => {
    const { deps } = makeDeps();
    const blocks = Array.from({ length: 50 }, (_, index) => ({
      id: `b${index}`,
      text: "x".repeat(2000),
    }));
    const result = await runTool(
      tool({}, async () => ({ sentence: "Read the draft.", data: { blocks } })),
      identity(),
      {},
      deps,
    );
    const data = result.structuredContent as {
      blocks: Array<{ text: string }>;
      truncated?: boolean;
    };
    expect(data.truncated).toBe(true);
    expect(data.blocks[0]!.text.length).toBeLessThanOrEqual(201);
    expect(result.content[0]!.text).toContain("shortened");
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(MCP_RESULT_MAX_BYTES);
  });
});

describe("runTool: nothing a handler throws leaves the server", () => {
  it("an Error with a path and a token becomes server_error with the generic sentence, and the log line has the tool and the code only", async () => {
    const { deps, logs } = makeDeps();
    const result = await runTool(
      tool({}, async () => {
        throw new Error("secret path /Users/gary/x and token hl_at_canary");
      }),
      identity(),
      {},
      deps,
    );
    expect(result.structuredContent).toEqual({
      ok: false,
      error: { code: "server_error", message: "Something went wrong on our side. Try again." },
    });
    const everything = JSON.stringify(result) + logs.join("\n");
    expect(everything).not.toMatch(/Users\/gary|hl_at_canary|secret path/);
    expect(logs).toContain("[mcp] tool=add_block ok=false code=server_error");
  });

  it("a failure's log line is the tool and the code and nothing else", async () => {
    const { deps, logs } = makeDeps();
    await runTool(
      tool({}, async () => {
        throw new ToolFailure("conflict", "This page changed.");
      }),
      identity(),
      { n: 1 },
      deps,
    );
    expect(logs).toEqual(["[mcp] tool=add_block ok=false code=conflict"]);
  });

  it("a handler that takes too long is cut off with its own sentence", async () => {
    const { deps } = makeDeps({ timeoutMs: 20 });
    const result = await runTool(
      tool({}, () => new Promise(() => undefined)),
      identity(),
      {},
      deps,
    );
    expect(result.structuredContent).toEqual({
      ok: false,
      error: { code: "server_error", message: "This took too long. Try again." },
    });
  });

  it("a page lookup that throws is server_error, and so is a failed suspension read", async () => {
    const lookup = makeDeps({
      loadPage: async () => {
        throw new Error("db password hunter2");
      },
    });
    const first = await runTool(tool(), identity(), {}, lookup.deps);
    expect(first.structuredContent).toMatchObject({ error: { code: "server_error" } });
    expect(JSON.stringify(first)).not.toContain("hunter2");

    const suspended = makeDeps({
      isSuspended: async () => {
        throw new Error("nope");
      },
    });
    const handler = vi.fn();
    const second = await runTool(
      tool({ handler: handler as never }),
      identity(),
      {},
      suspended.deps,
    );
    expect(second.structuredContent).toMatchObject({ error: { code: "server_error" } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("runTool: the activity row", () => {
  it("is written after the result is built, once, with the outcome by code only", async () => {
    const { deps, deferred, activity, flush } = makeDeps();
    const result = await runTool(
      tool(),
      identity(),
      { pageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", n: 3 },
      deps,
    );
    expect(result.isError).toBeUndefined();
    expect(activity).toHaveLength(0);
    expect(deferred).toHaveLength(1);
    await flush();
    expect(activity).toEqual([
      {
        userId: identity().userId,
        clientId: identity().clientId,
        grantId: identity().grantId,
        tokenId: identity().tokenId,
        tool: "add_block",
        pageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ok: true,
        errorCode: null,
      },
    ]);
  });

  it("refusals leave a row too: scope, rate limit, suspension and input", async () => {
    const rows: Array<
      [string, Parameters<typeof makeDeps>[0], unknown, Partial<ReturnType<typeof identity>>]
    > = [
      ["insufficient_scope", {}, {}, { scopes: ["hydlnk.read"] }],
      ["rate_limited", { limit: async () => ({ allowed: false, retryAfter: 3 }) }, {}, {}],
      ["account_suspended", { isSuspended: async () => true }, {}, {}],
      ["invalid_input", {}, { n: "x" }, {}],
    ];
    for (const [code, over, input, who] of rows) {
      const { deps, flush, activity } = makeDeps(over);
      await runTool(tool(), identity(who), input, deps);
      await flush();
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({ ok: false, errorCode: code });
    }
  });

  it("a failed insert is logged by code and never changes the result", async () => {
    const { deps, deferred, logs } = makeDeps({
      recordActivity: async () => {
        throw new Error("insert failed with token hl_at_canary");
      },
    });
    const result = await runTool(tool(), identity(), {}, deps);
    expect(result.isError).toBeUndefined();
    for (const work of deferred) await work();
    expect(logs.join("\n")).not.toContain("hl_at_canary");
    expect(logs.some((line) => line.includes("activity insert failed tool=add_block"))).toBe(true);
  });

  it("a defer that throws changes nothing either", async () => {
    const { deps } = makeDeps({
      defer: () => {
        throw new Error("outside a request");
      },
    });
    const result = await runTool(tool(), identity(), {}, deps);
    expect(result.isError).toBeUndefined();
  });
});
