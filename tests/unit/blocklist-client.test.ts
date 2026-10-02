import { describe, expect, it } from "vitest";
import {
  BLOCKED_FIELD_MESSAGE,
  BLOCKED_LINK_CODE,
  blockedPublishMessage,
  readBlockedLinkError,
  urlPointsAtHost,
} from "@/lib/blocklist";

describe("M5-03 blocked link error (what PostgREST hands the editor)", () => {
  it("reads the code, the offending hosts and the block ids", () => {
    expect(
      readBlockedLinkError({
        code: BLOCKED_LINK_CODE,
        message: "blocked_link",
        details: "blocked.example, www.other.example",
        hint: "lnk-aaaaaaaa,lnk-bbbbbbbb",
      }),
    ).toEqual({
      hosts: ["blocked.example", "www.other.example"],
      blockIds: ["lnk-aaaaaaaa", "lnk-bbbbbbbb"],
    });
  });

  it("recognises the message alone and tolerates empty details and hint", () => {
    expect(readBlockedLinkError({ message: "blocked_link", details: null, hint: "" })).toEqual({
      hosts: [],
      blockIds: [],
    });
  });

  it("is null for every other error (they stay retryable or follow their own path)", () => {
    expect(readBlockedLinkError(null)).toBeNull();
    expect(readBlockedLinkError(undefined)).toBeNull();
    expect(readBlockedLinkError({ code: "23514", message: "pages_draft_integrity" })).toBeNull();
    expect(readBlockedLinkError({ code: "HL001", message: "page limit reached" })).toBeNull();
    expect(readBlockedLinkError({ code: "PGRST301", message: "JWT expired" })).toBeNull();
  });
});

describe("M5-03 urlPointsAtHost (which field shows the inline error)", () => {
  const hosts = ["blocked.example", "[::1]"];

  it.each([
    "https://blocked.example",
    "https://BLOCKED.example/x?y=1",
    "https://blocked.example./x",
    "https://u@blocked.example:8443/",
    "  https://blocked.example  ",
    "https://[::1]:3000/x",
  ])("matches %s", (url) => {
    expect(urlPointsAtHost(url, hosts)).toBe(true);
  });

  it.each([
    "https://ok.example",
    "https://www.blocked.example",
    "https://notblocked.example",
    "https://ok.example/blocked.example",
    "blocked.example",
    "",
    "not a url",
  ])("does not match %s", (url) => {
    expect(urlPointsAtHost(url, hosts)).toBe(false);
  });

  it("matches nothing when no host was refused", () => {
    expect(urlPointsAtHost("https://blocked.example", [])).toBe(false);
  });
});

describe("M5-03 copy", () => {
  it("the field message is the one the acceptance names", () => {
    expect(BLOCKED_FIELD_MESSAGE).toBe("That site is blocked. Use a different link.");
  });

  it("the Publish banner reads as the acceptance names it for one link", () => {
    expect(blockedPublishMessage(["blocked.example"], 1)).toBe(
      "Can’t publish. 1 link points to a blocked site: blocked.example. Remove or change it.",
    );
  });

  it("and for several links", () => {
    expect(blockedPublishMessage(["a.example", "b.example"], 3)).toBe(
      "Can’t publish. 3 links point to blocked sites: a.example, b.example. Remove or change them.",
    );
  });
});
