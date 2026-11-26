import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
    expect(connect).toContain(
      "turning your blog on or off, and changing your blog’s address or its name",
    );
  });
});

/**
 * M18-12 step 2: "no file says fourteen". The connector had fourteen tools before Wave C and has
 * thirty-one now, so a count of fourteen tools anywhere is stale. `docs/features.json` is the one
 * exception: its rows are never reworded (CLAUDE.md), and M18-02's step names the older tools so.
 * PROGRESS.md is a log of what was true at the time (an M12 entry counts the tools of then), and
 * this file names the pattern it looks for.
 */
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) filesUnder(path, out);
    else if (/\.(ts|tsx|md|json|sql)$/.test(name)) out.push(path);
  }
  return out;
}

describe("the tool count", () => {
  it("no file outside features.json counts fourteen tools", () => {
    const stale = /fourteen\s+(?:older\s+|page\s+|mcp\s+)?tools/i;
    const files = [
      ...filesUnder("src"),
      ...filesUnder("tests").filter((path) => !path.endsWith("m18-mcp-words.test.ts")),
      ...filesUnder("docs").filter((path) => !path.endsWith("features.json")),
      "CLAUDE.md",
      ".claude/rules/mcp-oauth.md",
    ];
    const hits = files.filter((path) => stale.test(readFileSync(path, "utf8")));
    expect(hits).toEqual([]);
  });
});
