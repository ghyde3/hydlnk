import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCOPE_PUBLISH } from "@/lib/oauth/constants";
import { SCOPE_LABELS } from "@/lib/oauth/messages";

/**
 * M18-12: the consent screen and /connect say everything the publish permission allows. Besides
 * publishing, `update_content_type` turns the blog on or off, moves its address and renames it, so
 * the words name all three. Plain words: no exclamation mark, no "please".
 */

const connect = readFileSync("src/app/(marketing)/connect/page.tsx", "utf8").replace(/\s+/g, " ");

describe("the publish permission in words", () => {
  it("the consent hint names turning the blog on or off, its address and its name", () => {
    const hint = SCOPE_LABELS[SCOPE_PUBLISH].hint;
    expect(hint).toContain("turn your blog on or off");
    expect(hint).toContain("change its address");
    expect(hint).toContain("rename it");
    expect(hint).not.toMatch(/!|please/i);
  });

  it("/connect says the same", () => {
    expect(connect).toContain("turning your blog on or off, and changing your blog’s address or its name");
  });
});
