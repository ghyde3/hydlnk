/* eslint-disable @typescript-eslint/no-explicit-any -- a JSON-RPC answer is JSON whose shape each test checks */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENTRY_A, PAGE_A, makeDeps, ownedEntry } from "./support/mcp-fakes";

/**
 * M18-02 and M18-05 at the HTTP edge of /mcp: a 512 KiB body of non-ASCII text, sent as UTF-8 in
 * one `tools/call`, goes through the real endpoint (the 1 MiB read, the bearer wrapper, the SDK
 * handler, runTool, the tool) and reaches the writer byte for byte; one character more is refused on
 * `body` and never reaches it. Only the writer's two saves are spies; its body checks are real.
 */

const saved = vi.hoisted(() => ({ updateEntry: vi.fn(), createEntry: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));
vi.mock("@/lib/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content")>()),
  updateEntry: saved.updateEntry,
  createEntry: saved.createEntry,
  listEntries: async () => ({ ok: true, items: [], nextCursor: null }),
}));

const { createMcpEndpoint, createMcpServe } = await import("@/lib/mcp/endpoint");
const { createVerifyToken } = await import("@/lib/mcp/auth");
const { MCP_MAX_BODY_BYTES } = await import("@/lib/mcp/constants");

const APP = "http://app.localhost:3000";
const GOOD = "hl_at_" + "G".repeat(43);
const KIB_512 = 512 * 1024;
const utf8 = (text: string) => new TextEncoder().encode(text).length;

function endpointFor(draftBody: string) {
  const fakes = makeDeps({
    loadEntry: async () => ({
      ok: true,
      entry: ownedEntry({ draft: { title: "T", slug: "t", body: draftBody } }),
    }),
  });
  const endpoint = createMcpEndpoint({
    appOrigin: APP,
    verifyToken: createVerifyToken({
      verify: async (token) =>
        token === GOOD
          ? {
              userId: "11111111-1111-4111-8111-111111111111",
              clientId: "hlc_" + "a".repeat(32),
              grantId: "33333333-3333-4333-8333-333333333333",
              scopes: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
              tokenId: "44444444-4444-4444-8444-444444444444",
            }
          : null,
    }),
    serve: createMcpServe(() => fakes.deps, "1.0.0"),
    limit: async () => ({ allowed: true, retryAfter: 0 }),
    log: () => undefined,
  });
  return async (name: string, args: Record<string, unknown>) => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const response = await endpoint(
      new Request(`${APP}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${GOOD}`,
        },
        body: payload,
      }),
    );
    const text = await response.text();
    const data = text.split("\n").find((line) => line.startsWith("data:"));
    const message = data ? JSON.parse(data.slice(5)) : JSON.parse(text);
    return { status: response.status, bytes: utf8(payload), result: message.result as any };
  };
}

beforeEach(() => {
  saved.updateEntry.mockReset();
  saved.createEntry.mockReset();
  saved.updateEntry.mockResolvedValue({ ok: true, rev: 4, unchanged: false });
  saved.createEntry.mockResolvedValue({ ok: true, id: ENTRY_A, rev: 1, updatedAt: "x" });
});

describe("a 512 KiB body of non-ASCII text through the endpoint", () => {
  for (const [label, unit, width] of [
    ["two-byte", "é", 2],
    ["three-byte", "語", 3],
    ["astral", "😀", 4],
  ] as const) {
    it(`${label} characters: the full 512 KiB arrives intact; one character more is invalid_input on body`, async () => {
      const count = Math.floor(KIB_512 / width);
      const body = unit.repeat(count);
      expect(utf8(body)).toBeLessThanOrEqual(KIB_512);
      expect(utf8(body)).toBeGreaterThan(KIB_512 - width);
      const call = endpointFor("old");

      const updated = await call("update_entry", { entryId: ENTRY_A, ifRev: 3, body });
      expect(updated.status).toBe(200);
      expect(updated.bytes).toBeLessThan(MCP_MAX_BODY_BYTES);
      expect(
        updated.result.isError,
        JSON.stringify(updated.result.structuredContent),
      ).toBeUndefined();
      expect(saved.updateEntry).toHaveBeenCalledTimes(1);
      const draft = saved.updateEntry.mock.calls[0]![0].draft;
      expect(draft.body === body).toBe(true);
      expect(updated.result.structuredContent.bodyChars).toBe(Array.from(body).length);

      const created = await call("create_entry", { pageId: PAGE_A, title: "Long", body });
      expect(
        created.result.isError,
        JSON.stringify(created.result.structuredContent),
      ).toBeUndefined();
      expect(saved.createEntry.mock.calls[0]![0].draft.body === body).toBe(true);

      saved.updateEntry.mockClear();
      const over = await call("update_entry", {
        entryId: ENTRY_A,
        ifRev: 3,
        body: `${body}${unit}`,
      });
      expect(over.status).toBe(200);
      expect(over.result.structuredContent.error).toMatchObject({ code: "invalid_input" });
      expect(over.result.structuredContent.error.issues).toEqual([
        { path: "body", message: "The body is over 512 KiB." },
      ]);
      expect(saved.updateEntry).not.toHaveBeenCalled();
    });
  }
});
