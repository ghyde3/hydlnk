import { describe, expect, it } from "vitest";
import {
  PENDING_HANDLE_COOKIE,
  PENDING_HANDLE_MAX_AGE_SECONDS,
  parsePendingHandle,
  pickPendingHandle,
} from "@/lib/handles/pending";

/** M1-13: a missing, tampered or over-long pending-handle cookie must never create a page. */
describe("M1-13 pending handle", () => {
  it("uses the documented cookie name and a 15 minute life", () => {
    expect(PENDING_HANDLE_COOKIE).toBe("hl-pending-handle");
    expect(PENDING_HANDLE_MAX_AGE_SECONDS).toBeLessThanOrEqual(900);
  });

  it.each(["zq-gs-1", "abc", "a".repeat(30)])("accepts %j", (value) => {
    expect(parsePendingHandle(value)).toBe(value);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["not a string", 42],
    ["empty", ""],
    ["too short", "ab"],
    ["over-long", "a".repeat(31)],
    ["mixed case (not cleaned up)", "Mara"],
    ["tampered with markup", "<script>x</script>"],
    ["with a space", "zq gs"],
    ["leading dash", "-mara"],
    ["punycode", "xn--pple-43d"],
  ])("rejects a %s value", (_label, value) => {
    expect(parsePendingHandle(value)).toBeNull();
  });

  it("prefers the metadata carrier, falls back to the cookie, else nothing", () => {
    expect(pickPendingHandle({ metadata: "zq-su-1", cookie: "zq-gs-1" })).toBe("zq-su-1");
    expect(pickPendingHandle({ metadata: "", cookie: "zq-gs-1" })).toBe("zq-gs-1");
    expect(pickPendingHandle({ metadata: undefined, cookie: "BAD!" })).toBeNull();
    expect(pickPendingHandle({})).toBeNull();
  });
});
