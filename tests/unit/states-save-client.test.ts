import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft } from "@/lib/document";

/**
 * M5-15: what the browser-side draft write reports for each answer of PostgREST. Only a 401 is the
 * session being gone ("unauthorized", which the queue does not retry on a timer); a 5xx, a network
 * error and an RLS refusal (403) stay retryable errors; a 23514 is too large; no row is a conflict.
 */

type Answer = {
  data: { id: string }[] | null;
  error: { code?: string; message?: string } | null;
  status: number;
};
let answer: Answer;
const select = vi.fn(async () => answer);
const builder: Record<string, unknown> = {};
for (const name of ["update", "eq", "is"]) builder[name] = vi.fn(() => builder);
builder.select = select;

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ from: () => builder }),
}));

const { createDraftSaver } = await import("@/lib/editor/save-client");
const save = createDraftSaver("00000000-0000-4000-8000-0000000000b1");
const doc = { ...emptyDraft("mara"), rev: 4 };

beforeEach(() => {
  answer = { data: [{ id: "x" }], error: null, status: 200 };
  select.mockClear();
});

describe("M5-15 createDraftSaver maps the answer", () => {
  it("a 401 (expired JWT, or the anonymous role) is unauthorized", async () => {
    answer = { data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 };
    expect(await save(doc, "3")).toEqual({ kind: "unauthorized" });
    answer = {
      data: null,
      error: { code: "42501", message: "permission denied for table pages" },
      status: 401,
    };
    expect(await save(doc, "3")).toEqual({ kind: "unauthorized" });
    answer = { data: null, error: { message: "" }, status: 401 };
    expect(await save(doc, null)).toEqual({ kind: "unauthorized" });
  });

  it("a 403, a 500 and a 503 stay retryable errors", async () => {
    for (const status of [403, 500, 502, 503]) {
      answer = { data: null, error: { code: "XX000", message: "boom" }, status };
      expect(await save(doc, "3"), String(status)).toEqual({ kind: "error" });
    }
  });

  it("a check violation (23514, HTTP 400) is too-large", async () => {
    answer = { data: null, error: { code: "23514", message: "check" }, status: 400 };
    expect(await save(doc, "3")).toEqual({ kind: "too-large" });
  });

  it("no row matched is a conflict; a row is ok", async () => {
    answer = { data: [], error: null, status: 200 };
    expect(await save(doc, "3")).toEqual({ kind: "conflict" });
    answer = { data: [{ id: "x" }], error: null, status: 200 };
    expect(await save(doc, "3")).toEqual({ kind: "ok" });
  });
});
