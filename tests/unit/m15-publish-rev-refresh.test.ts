// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M15-10 (A2): Publish moves the rev of a page entry whose first system revision kept the original
 * draft (a page the mover rewrote). The editor used to re-read the stored revs after Publish and
 * Unpublish, with an unlocked GET, and adopted whatever it found: a rev another writer (an MCP tool)
 * made in between was adopted too, and the editor's next save went over that writer's draft.
 *
 * Now the publish answers the revs it left (read under its own locks) and the editor adopts those.
 * These checks keep the unlocked read from coming back into the publish path.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("the editor never re-reads revs after Publish or Unpublish", () => {
  it("the sub-pages' hook reads no revs: it adopts the ones it is given", () => {
    const src = read("src/components/site/use-site-pages.ts");
    expect(src).not.toContain("readEntryRevs");
    expect(src).not.toMatch(/revisions\.refresh/);
    const start = src.indexOf("const markPublished = useCallback");
    const body = src.slice(start, src.indexOf("\n  );", start));
    expect(body).toContain("revisions.adopt(id, rev, was)");
  });

  it("the sub-pages' revisions module does not read the database", () => {
    const src = read("src/lib/site-pages/save-client.ts");
    expect(src).not.toContain("readEntryRevs");
    expect(src).not.toMatch(/\brefresh\b/);
  });

  it("Home's saver reads the stored rev only for a save that sends no blocks", () => {
    const src = read("src/lib/editor/save-client.ts");
    expect(src).not.toContain("refreshHomeRev");
    expect(src.match(/readEntryRevs\(/g)).toHaveLength(1);
  });

  it("the workspace adopts the revs Publish all changes answered", () => {
    const src = read("src/components/workspace/workspace-provider.tsx");
    expect(src).not.toMatch(/refreshHomeRev|readEntryRevs|\.refresh\(siteId\)/);
    expect(src).toContain("markSitePublished(siteForms, result.revs.entries, sentPages)");
    expect(src).toContain("adoptHomeRev(homeLeft, heldHome)");
  });

  it("the gate publishes through publish_site_revs and answers what it left", () => {
    const src = read("src/lib/publish/core.ts");
    expect(src).toContain('admin.rpc("publish_site_revs"');
    expect(src).not.toContain('admin.rpc("publish_site"');
    expect(src).toContain("return { ok: true, publishedAt, revs }");
  });
});
