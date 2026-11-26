/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ENTRY_A, identity, makeDeps, ownedEntry } from "./support/mcp-fakes";
import { CONTENT_TOOL_NAMES } from "./support/mcp-content";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));
// get_entry asks the writer where the blog is, for the live address: a read this test is not about.
vi.mock("@/lib/content", () => ({
  listTypes: async () => ({ ok: true, types: [] }),
  postDraftIssues: () => [],
}));

const { successResult, byteLength } = await import("@/lib/mcp/result");
const { runTool } = await import("@/lib/mcp/run-tool");
const { TOOLS, toolByName } = await import("@/lib/mcp/tools");
const { contentHash } = await import("@/lib/mcp/body-range");
const { MCP_MAX_BODY_BYTES, MCP_RESULT_MAX_BYTES } = await import("@/lib/mcp/constants");
import type { AnyToolDefinition } from "@/lib/mcp/types";

/**
 * M18-02: a content tool's result is never shortened, and the fourteen older tools still are. The
 * request body the endpoint reads is 1 MiB (the endpoint's own tests hold the 413).
 */

const long = "x".repeat(900);
const big = { rows: Array.from({ length: 100 }, (_, index) => ({ index, text: long })) };

describe("successResult", () => {
  it("over 60 KiB a result is shortened to 200 characters a string, as before", () => {
    expect(byteLength(JSON.stringify(big))).toBeGreaterThan(MCP_RESULT_MAX_BYTES);
    const result = successResult({ sentence: "Read it.", data: big });
    const data = JSON.parse(result.content[1]!.text);
    expect(data.truncated).toBe(true);
    expect(data.rows[0].text).toBe(`${"x".repeat(200)}…`);
    expect(result.content[0]!.text).toContain("Long text was shortened.");
  });

  it("an exact result is never cut, whatever its size", () => {
    const result = successResult({ sentence: "Read it.", data: big, exact: true });
    const data = JSON.parse(result.content[1]!.text);
    expect(data).toEqual(big);
    expect("truncated" in data).toBe(false);
    expect(result.structuredContent).toEqual({ ok: true, ...big });
    expect(result.content[0]!.text).toBe("Read it.");
  });

  it("exact is not part of the answer", () => {
    const result = successResult({ sentence: "Done.", data: { a: 1 }, exact: true });
    expect(JSON.stringify(result)).not.toContain("exact");
  });
});

describe("through runTool", () => {
  const tool = (exact: boolean): AnyToolDefinition =>
    ({
      name: "get_entry",
      title: "Test",
      description: "Test tool.",
      scope: "hydlnk.read",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      input: z.strictObject({}),
      page: "none",
      handler: async () => ({ sentence: "Read it.", data: big, ...(exact ? { exact: true } : {}) }),
    }) as AnyToolDefinition;

  it("the mark decides: with it the data is whole, without it the data is shortened", async () => {
    const whole = await runTool(tool(true), identity(), {}, makeDeps().deps);
    expect(JSON.parse(whole.content[1]!.text)).toEqual(big);
    const cut = await runTool(tool(false), identity(), {}, makeDeps().deps);
    expect(JSON.parse(cut.content[1]!.text).truncated).toBe(true);
  });

  it("get_entry returns a body range of 30,000 astral characters whole, with the hash of the whole body", async () => {
    const body = "😀".repeat(131_072);
    const { deps } = makeDeps({
      loadEntry: async (_user, id) => ({
        ok: true,
        entry: ownedEntry({ id, draft: { title: "Big", slug: "big", body } }),
      }),
    });
    const result = (await runTool(
      toolByName("get_entry")!,
      identity(),
      { entryId: ENTRY_A, length: 30_000 },
      deps,
    )) as any;
    expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
    const data = JSON.parse(result.content[1].text);
    expect(byteLength(result.content[1].text)).toBeGreaterThan(MCP_RESULT_MAX_BYTES);
    expect(data.truncated).toBeUndefined();
    expect(data.body).toBe("😀".repeat(30_000));
    expect(data).toMatchObject({ bodyOffset: 0, nextOffset: 30_000, bodyChars: 131_072 });
    expect(data.contentHash).toBe(contentHash(body));
    // Text plus structuredContent stay under what a client takes for one result (150,000 characters each).
    expect(result.content[1].text.length).toBeLessThan(150_000);
  });
});

describe("which tools are exact", () => {
  it("the fourteen older tools still shorten: none of them marks its result", async () => {
    const older = TOOLS.filter((tool) => !CONTENT_TOOL_NAMES.includes(tool.name));
    expect(older).toHaveLength(14);
    const { readFileSync } = await import("node:fs");
    for (const tool of older) {
      const file = `src/lib/mcp/tools/${tool.name.replace(/_/g, "-")}.ts`;
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\bexact:/);
    }
  });

  it("every content tool marks every result it returns", async () => {
    const { readFileSync } = await import("node:fs");
    for (const name of CONTENT_TOOL_NAMES) {
      const file = `src/lib/mcp/tools/${name.replace(/_/g, "-")}.ts`;
      const source = readFileSync(file, "utf8");
      const returns = source.match(/sentence:/g)?.length ?? 0;
      const marks = source.match(/exact: true/g)?.length ?? 0;
      expect(returns, file).toBeGreaterThan(0);
      expect(marks, file).toBe(returns);
    }
  });
});

describe("the request size", () => {
  it("the endpoint reads at most 1 MiB, enough for a full 512 KiB body as JSON", () => {
    expect(MCP_MAX_BODY_BYTES).toBe(1024 * 1024);
    const body = "a".repeat(512 * 1024);
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "update_entry", arguments: { entryId: ENTRY_A, ifRev: 1, body } },
    });
    expect(byteLength(request)).toBeLessThan(MCP_MAX_BODY_BYTES);
  });
});
