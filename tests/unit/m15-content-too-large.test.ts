import { describe, expect, it } from "vitest";
import { CONTENT_MESSAGES, mapDbError } from "@/lib/content/errors";

/**
 * The entry size checks (draft over 1 MiB, published copy over its cap) raise 23514 with the message
 * `draft_too_large` or `published_too_large`; both are the existing too-large refusal.
 */
describe("the entry size errors map to too_large", () => {
  it.each(["draft_too_large", "published_too_large"])("%s (23514)", (message) => {
    const out = mapDbError({ code: "23514", message });
    expect(out).toMatchObject({
      ok: false,
      status: 413,
      error: "too_large",
      message: CONTENT_MESSAGES.too_large,
    });
  });

  it("the older CHECK on a draft still does", () => {
    expect(
      mapDbError({
        code: "23514",
        message: "violates check constraint content_entries_draft_integrity",
      }).error,
    ).toBe("too_large");
  });

  it("another 23514 stays a generic error", () => {
    expect(mapDbError({ code: "23514", message: "something_else" }).error).toBe("error");
  });
});
