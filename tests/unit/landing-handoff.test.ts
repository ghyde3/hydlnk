import { describe, expect, it } from "vitest";
import { signupUrl } from "@/components/marketing/signup-handoff";

describe("signupUrl", () => {
  it.each([
    ["localhost:3000", "http://app.localhost:3000/signup"],
    ["hydlnk.com", "https://app.hydlnk.com/signup"],
  ])("builds the destination for %s", (rootDomain, base) => {
    expect(signupUrl(rootDomain, "Mara_Studio")).toBe(`${base}?handle=marastudio`);
    expect(signupUrl(rootDomain, "mara")).toBe(`${base}?handle=mara`);
  });

  it.each([
    ["localhost:3000", "http://app.localhost:3000/signup"],
    ["hydlnk.com", "https://app.hydlnk.com/signup"],
  ])("carries no parameter for an empty value on %s", (rootDomain, base) => {
    expect(signupUrl(rootDomain)).toBe(base);
    expect(signupUrl(rootDomain, "")).toBe(base);
    expect(signupUrl(rootDomain, "  ")).toBe(base);
    expect(signupUrl(rootDomain, "___")).toBe(base);
  });

  it("normalizes with the shared handle rules (lowercase, drop the rest, never trim hyphens or truncate)", () => {
    const base = "http://app.localhost:3000/signup";
    expect(signupUrl("localhost:3000", "  Mara_Studio ")).toBe(`${base}?handle=marastudio`);
    expect(signupUrl("localhost:3000", "-Mara-")).toBe(`${base}?handle=-mara-`);
    expect(signupUrl("localhost:3000", "Mará")).toBe(`${base}?handle=mar`);
  });

  it("hands a 35-character value off without truncation and with no other parameter", () => {
    const long = "a".repeat(35);
    const url = new URL(signupUrl("hydlnk.com", long));
    expect(url.searchParams.get("handle")).toBe(long);
    expect([...url.searchParams.keys()]).toEqual(["handle"]);
  });
});
