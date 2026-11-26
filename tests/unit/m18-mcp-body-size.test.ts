/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { Lexer, marked } from "marked";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTRY_A, PAGE_A, identity, makeDeps, ownedEntry } from "./support/mcp-fakes";

/**
 * M18-05 (plan 3.5, abuse case 9): a body over 512 KiB is refused before anything builds or lexes
 * it. `bodyEdits` count the length a step would make before building it; `preparePostDraft` and
 * the writer's `checkPostBody` check the bytes before the first lexer call; the `body` field has a
 * character bound. No database: the admin client throws, so a test that reached it would fail.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));
vi.mock("@/lib/publish/invalidate", () => ({
  invalidatePage: vi.fn(),
  invalidateEntry: vi.fn(),
  invalidateType: vi.fn(),
}));
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly: vi.fn() }));
// Every body is lexed by the one bounded lexer (M17): its entry is counted here.
const lexer = vi.hoisted(() => ({ lexed: vi.fn<() => void>() }));
vi.mock("@/lib/blog/markdown/lex", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blog/markdown/lex")>();
  return {
    ...real,
    lexTokens: (markdown: string) => {
      lexer.lexed();
      return real.lexTokens(markdown);
    },
  };
});

const { applyBodyEdits } = await import("@/lib/mcp/body-edit");
const { runTool } = await import("@/lib/mcp/run-tool");
const { toolByName } = await import("@/lib/mcp/tools");
const { checkPostBody } = await import("@/lib/content");

const KIB_512 = 512 * 1024;
const OVER = "The body is over 512 KiB.";
const failure = (result: any) => result.structuredContent?.error as Record<string, any>;

const lexed = lexer.lexed;
beforeEach(() => {
  lexed.mockClear();
  // marked's lexer is never a body's reader any more; it is watched so a regression shows here.
  vi.spyOn(Lexer.prototype, "lex");
  vi.spyOn(marked, "lexer");
});
afterEach(() => vi.restoreAllMocks());

const neverLexed = () => {
  expect(lexed).not.toHaveBeenCalled();
  expect(Lexer.prototype.lex).not.toHaveBeenCalled();
  expect(marked.lexer).not.toHaveBeenCalled();
};

/** update_entry on a post whose stored draft holds `body`, through the real runTool and handler. */
function runUpdate(body: string, args: Record<string, unknown>) {
  const { deps } = makeDeps({
    loadEntry: async () => ({ ok: true, entry: ownedEntry({ draft: { title: "T", body } }) }),
  });
  return runTool(
    toolByName("update_entry")!,
    identity(),
    { entryId: ENTRY_A, ifRev: 3, ...args },
    deps,
  );
}

describe("applyBodyEdits stops before it builds a body over the limit", () => {
  it("one short find with all and a long replace on a full body is refused at once, nothing built", () => {
    const body = "a".repeat(KIB_512);
    const split = vi.spyOn(String.prototype, "split");
    const started = performance.now();
    const out = applyBodyEdits(body, [{ find: "a", replace: "b".repeat(1000), all: true }]);
    const took = performance.now() - started;
    expect(out).toEqual({ ok: false, index: 0, matches: KIB_512, tooLarge: true });
    expect(took).toBeLessThan(100);
    expect(split).not.toHaveBeenCalled();
  });

  it("growth across several steps is caught at the step that passes the limit", () => {
    const body = `${"x".repeat(400_000)} ONE`;
    const out = applyBodyEdits(body, [
      { find: "ONE", replace: `${"y".repeat(100_000)} TWO` },
      { find: "TWO", replace: "z".repeat(20_000) },
      { find: "z", replace: "zz", all: true },
    ]);
    expect(out).toMatchObject({ ok: false, index: 2, tooLarge: true });
    // Exactly at the limit is fine; one more is not.
    const exact = applyBodyEdits("ab", [{ find: "b", replace: "c".repeat(KIB_512 - 1) }]);
    expect(exact.ok).toBe(true);
    expect(applyBodyEdits("ab", [{ find: "b", replace: "c".repeat(KIB_512) }])).toMatchObject({
      ok: false,
      tooLarge: true,
    });
    // A step that shrinks the body is never refused for size.
    expect(applyBodyEdits("a".repeat(KIB_512), [{ find: "aa", replace: "", all: true }])).toEqual({
      ok: true,
      body: "",
    });
  });
});

describe("update_entry with bodyEdits that multiply the body", () => {
  it("is invalid_input on body, fast, and never reaches the lexer or the writer", async () => {
    const started = performance.now();
    const out = await runUpdate("a".repeat(KIB_512), {
      bodyEdits: [{ find: "a", replace: "b".repeat(1000), all: true }],
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(failure(out)).toMatchObject({ code: "invalid_input" });
    expect(failure(out).issues).toEqual([{ path: "body", message: OVER }]);
    expect(failure(out).details).toEqual({ step: 1 });
    neverLexed();
  });

  it("growth over several edits names the step that passes the limit", async () => {
    const out = await runUpdate(`${"x".repeat(500_000)} A`, {
      bodyEdits: [
        { find: " A", replace: " B" },
        { find: " B", replace: "c".repeat(30_000) },
      ],
    });
    expect(failure(out)).toMatchObject({ code: "invalid_input", details: { step: 2 } });
    expect(failure(out).issues[0].path).toBe("body");
    neverLexed();
  });

  it("a replace longer than the body limit is refused by the input schema", async () => {
    const out = await runUpdate("x", {
      bodyEdits: [{ find: "x", replace: "r".repeat(KIB_512 + 1) }],
    });
    expect(failure(out)).toMatchObject({ code: "invalid_input" });
    expect(failure(out).issues[0].path).toBe("bodyEdits[0].replace");
    neverLexed();
  });
});

describe("an oversized body on create_entry and update_entry never reaches the lexer", () => {
  // 300,000 two-byte characters: under the character bound, 600,000 bytes of UTF-8.
  const twoByte = "é".repeat(300_000);
  const ascii = "a".repeat(KIB_512 + 1);

  it("create_entry: over the character bound and over the byte limit", async () => {
    for (const body of [ascii, twoByte]) {
      const { deps } = makeDeps();
      const out = await runTool(
        toolByName("create_entry")!,
        identity(),
        { pageId: PAGE_A, title: "T", body },
        deps,
      );
      expect(failure(out), body.slice(0, 4)).toMatchObject({ code: "invalid_input" });
      expect(failure(out).issues).toEqual([{ path: "body", message: OVER }]);
    }
    neverLexed();
  });

  it("update_entry: a whole body over the limit", async () => {
    for (const body of [ascii, twoByte]) {
      const out = await runUpdate("x", { body });
      expect(failure(out), body.slice(0, 4)).toMatchObject({ code: "invalid_input" });
      expect(failure(out).issues).toEqual([{ path: "body", message: OVER }]);
    }
    neverLexed();
  });

  it("checkPostBody refuses the bytes before it lexes", async () => {
    const out = await checkPostBody({
      actor: { userId: identity().userId, source: "mcp" },
      draft: { title: "T", body: twoByte },
    });
    expect(out).toMatchObject({ ok: false, error: "invalid" });
    expect(out!.issues).toEqual([{ path: "body", message: OVER }]);
    neverLexed();
    // 512 KiB of astral characters is exactly the limit: it is lexed (and passes).
    expect(
      await checkPostBody({
        actor: { userId: identity().userId, source: "mcp" },
        draft: { title: "T", body: "😀".repeat(KIB_512 / 4) },
      }),
    ).toBeNull();
    expect(lexed).toHaveBeenCalled();
    expect(Lexer.prototype.lex).not.toHaveBeenCalled();
  });
});
