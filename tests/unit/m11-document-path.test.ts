import { describe, expect, it } from "vitest";
import {
  RESERVED_PATHS,
  SUB_PAGE_PATH_PATTERN,
  isReservedPath,
  isValidSubPagePath,
  subPagePathError,
  suggestPath,
} from "@/lib/document";
import { PLAIN_404_PATH, INTERNAL_PREFIXES } from "@/lib/routing/paths";

describe("M11-04 sub-page path rule", () => {
  it("accepts one lowercase segment of 1 to 40 characters", () => {
    for (const path of [
      "items",
      "a",
      "a1",
      "my-page",
      "a-b-c",
      "2026",
      "x".repeat(40),
      "directions",
    ]) {
      expect(isValidSubPagePath(path), path).toBe(true);
    }
  });

  it("rejects everything else", () => {
    const bad = [
      "",
      "Items",
      "-a",
      "a-",
      "a_b",
      "a b",
      "a/b",
      "/items",
      "items/",
      "x".repeat(41),
      "café",
      "a.b",
      "a--",
    ];
    for (const path of bad) expect(isValidSubPagePath(path), JSON.stringify(path)).toBe(false);
    expect(SUB_PAGE_PATH_PATTERN.source).toBe("^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$");
  });

  it("rejects the reserved list and anything starting hl-", () => {
    for (const path of [
      "og",
      "r",
      "c",
      "api",
      "media",
      "share",
      "auth",
      "app",
      "_t",
      "sitemap",
      "robots",
    ]) {
      expect(isReservedPath(path), path).toBe(true);
      expect(isValidSubPagePath(path), path).toBe(false);
    }
    expect(isValidSubPagePath("hl-query-count")).toBe(false);
    expect(isValidSubPagePath("hl-")).toBe(false);
    expect(isValidSubPagePath("hl")).toBe(true);
    expect(isValidSubPagePath("about-hl-x")).toBe(true);
  });

  it("includes what tenant routing already owns", () => {
    for (const prefix of INTERNAL_PREFIXES)
      expect(isReservedPath(prefix.slice(1)), prefix).toBe(true);
    expect(RESERVED_PATHS).toContain(PLAIN_404_PATH.slice(1).split("/")[0]);
    expect(isReservedPath("404-not-found")).toBe(true);
  });

  it("names the problem", () => {
    expect(subPagePathError("items")).toBeNull();
    expect(subPagePathError("Items")).toMatch(/lowercase/);
    expect(subPagePathError("og")).toMatch(/reserved/);
  });
});

describe("M11-04 suggestPath", () => {
  it("slugifies a title", () => {
    expect(suggestPath("Garage Sale Items!")).toBe("garage-sale-items");
    expect(suggestPath("  Café menu  ")).toBe("cafe-menu");
    expect(suggestPath("A -- B")).toBe("a-b");
  });

  it("falls back to page for a title without letters or digits", () => {
    expect(suggestPath("")).toBe("page");
    expect(suggestPath("\u{1F389}\u{1F389}")).toBe("page");
  });

  it("adds -2, -3 on a clash", () => {
    expect(suggestPath("Items", ["items"])).toBe("items-2");
    expect(suggestPath("Items", ["items", "items-2"])).toBe("items-3");
    expect(suggestPath("Items", new Set(["items", "items-3"]))).toBe("items-2");
  });

  it("adds a suffix on a reserved hit", () => {
    expect(suggestPath("API")).toBe("api-2");
    expect(suggestPath("Share")).toBe("share-2");
    expect(suggestPath("HL-test")).toBe("test");
    expect(suggestPath("hl-")).toBe("hl");
  });

  it("always returns a valid path, also for a long title and a suffix", () => {
    const long = "word ".repeat(30);
    const first = suggestPath(long);
    expect(first.length).toBeLessThanOrEqual(40);
    expect(isValidSubPagePath(first)).toBe(true);
    const second = suggestPath(long, [first]);
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(40);
    expect(isValidSubPagePath(second)).toBe(true);
  });
});
