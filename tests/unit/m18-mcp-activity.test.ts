/* eslint-disable @typescript-eslint/no-explicit-any -- rows and tool results are JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import { CONTENT_TOOL_NAMES } from "./support/mcp-content";
import { contentHarness, type BlogOwner, type ContentHarness } from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const { run } = await stackIsUp();

/**
 * M18-12 against the local database: each call of a content tool leaves ONE activity row with the
 * tool's name, the site and the outcome, and nothing of what was sent. Every content tool is run
 * with a marker in every argument; the marker is in no activity row and in no log line.
 */
describe.skipIf(!run)("the activity log of the content tools (local Supabase)", () => {
  let h: ContentHarness;
  let o: BlogOwner;
  const MARK = "zqmarker7c41";
  const UPPER = "ZQMARKER7C41";
  const console_: string[] = [];
  const spies: Array<{ mockRestore: () => void }> = [];
  const rows = async () => {
    const { data, error } = await h.admin
      .from("mcp_activity")
      .select("*")
      .eq("user_id", o.userId)
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    return data as any[];
  };
  const holdsMarker = (value: unknown) =>
    JSON.stringify(value).toLowerCase().includes(MARK.toLowerCase());

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    o = await h.owner("act", { plan: "pro", publishable: true });
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          console_.push(
            args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "),
          );
        }),
      );
    }
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    await h?.cleanup();
  });

  it("every content tool, with a marker in every argument: one row a call, and the marker in no row and no log line", async () => {
    const before = (await rows()).length;
    const calls: Array<{ name: string; ok: boolean; code: string | null; owned: boolean }> = [];
    const go = async (name: string, input: Record<string, unknown>, owned = true) => {
      const out = await h.call(name, input, o);
      await h.rt.flush();
      calls.push({ name, ok: !out.isError, code: out.error?.code ?? null, owned });
      return out;
    };
    const text = `${UPPER} ${MARK}`;

    // Calls that work, with the marker in everything a person could type.
    const created = await go("create_entry", {
      pageId: o.pageId,
      title: `Title ${text}`,
      slug: `slug-${MARK}`,
      body: `Body ${text}\n\n[link ${MARK}](https://example.com/${MARK})`,
      excerpt: `Excerpt ${text}`,
      seoTitle: `SEO ${text}`,
      seoDescription: `Description ${text}`,
    });
    expect(created.isError, JSON.stringify(created.error)).toBe(false);
    const entryId = created.json!.id as string;
    const updated = await go("update_entry", {
      entryId,
      ifRev: 1,
      title: `Second ${text}`,
      bodyEdits: [{ find: `Body ${UPPER}`, replace: `Edited ${text}` }],
    });
    expect(updated.isError, JSON.stringify(updated.error)).toBe(false);
    const term = await go("create_term", {
      pageId: o.pageId,
      taxonomy: "tag",
      name: `Tag ${text}`,
      slug: `tag-${MARK}`,
    });
    expect(term.isError, JSON.stringify(term.error)).toBe(false);
    const termId = term.json!.term.id as string;
    await go("rename_term", {
      pageId: o.pageId,
      termId,
      name: `Renamed ${text}`,
      slug: `r-${MARK}`,
    });
    await go("list_entries", { pageId: o.pageId, q: text });
    await go("list_terms", { pageId: o.pageId });
    await go("list_content_types", { pageId: o.pageId });
    await go("get_entry", { entryId });
    await go("list_revisions", { entryId });
    await go("update_content_type", {
      pageId: o.pageId,
      archivePath: `p-${MARK}`,
      label: `Label ${text}`,
      labelPlural: `Plural ${text}`,
    });
    const published = await go("publish_entry", { entryId, ifRev: updated.json!.rev });
    expect(published.isError, JSON.stringify(published.error)).toBe(false);
    const down = await go("unpublish_entry", { entryId, ifRev: published.json!.rev });
    const revision = (await h.revisions(entryId))[0]!.rev;
    const restoredRevision = await go("restore_revision", {
      entryId,
      revision,
      ifRev: down.json!.rev,
    });
    const trashed = await go("delete_entry", {
      entryId,
      ifRev: restoredRevision.json?.rev ?? down.json!.rev,
    });
    await go("restore_entry", { entryId, ifRev: trashed.json!.rev });
    await go("delete_term", { pageId: o.pageId, termId });
    await go("publish_design", { pageId: o.pageId, ifDesignRev: MARK });

    // Calls that are refused, with the marker where an id, a number or a field name should be.
    await go("get_entry", { entryId: MARK }, false);
    await go("get_entry", { entryId, pageId: MARK }, false);
    await go("update_entry", { entryId: MARK, ifRev: 1, title: text }, false);
    await go("update_entry", { entryId, ifRev: MARK, title: text }, false);
    await go("update_entry", { entryId, ifRev: 1, [MARK]: text }, false);
    await go("update_entry", {
      entryId,
      ifRev: 999,
      body: `![${MARK}](https://${MARK}.example/x.png)`,
    });
    await go("create_entry", { pageId: MARK, title: text }, false);
    await go("create_entry", { pageId: o.pageId, title: text, slug: `${UPPER}/../x` });
    await go("create_entry", { pageId: o.pageId, title: text, body: `[x](javascript:${MARK})` });
    await go("create_entry", { pageId: o.pageId, title: text, featuredImageId: `${MARK}.webp` });
    await go("create_entry", { pageId: o.pageId, title: text, categories: [MARK] });
    await go("delete_entry", { entryId: MARK, ifRev: 1 }, false);
    await go("restore_entry", { entryId: MARK, ifRev: 1 }, false);
    await go("create_term", { pageId: o.pageId, taxonomy: MARK, name: text }, false);
    await go("create_term", { pageId: o.pageId, taxonomy: "category", name: text, parentId: MARK });
    await go("rename_term", { pageId: o.pageId, termId: MARK, name: text });
    await go("delete_term", { pageId: o.pageId, termId: MARK });
    await go("list_entries", { pageId: o.pageId, cursor: MARK, termId: MARK });
    await go("list_entries", { pageId: o.pageId, sort: MARK }, false);
    await go("list_terms", { pageId: MARK }, false);
    await go("list_content_types", { pageId: MARK }, false);
    // The site is the caller's own (the row names it); the page under it is not found.
    await go("list_revisions", { pageId: o.pageId, subPageId: MARK });
    await go("restore_revision", { entryId: MARK, revision: 1, ifRev: 1 }, false);
    await go("publish_entry", { entryId: MARK, ifRev: 1 }, false);
    await go("publish_entry", { pageId: o.pageId, subPageId: MARK, ifRev: 1 });
    await go("unpublish_entry", { entryId: MARK, ifRev: 1 }, false);
    await go("publish_design", { pageId: MARK, ifDesignRev: text }, false);
    await go("update_content_type", { pageId: o.pageId, type: MARK, enabled: true });
    await go("update_content_type", { pageId: o.pageId, archivePath: `${UPPER} ${MARK}` });

    // Every content tool was run.
    expect([...new Set(calls.map((call) => call.name))].sort()).toEqual(
      [...CONTENT_TOOL_NAMES].sort(),
    );
    // The marker did reach the tools: some calls worked and stored it, others were refused for it.
    expect(calls.some((call) => call.ok)).toBe(true);
    expect(calls.some((call) => !call.ok)).toBe(true);
    expect(JSON.stringify((await h.row(entryId)).draft).toLowerCase()).toContain(MARK);

    // One row a call, in order, with the tool's name, the site when the caller owned it, the outcome.
    const written = (await rows()).slice(before);
    expect(written).toHaveLength(calls.length);
    written.forEach((row, index) => {
      const call = calls[index]!;
      expect(row.tool, `row ${index}`).toBe(call.name);
      expect(row.ok, `row ${index} ${call.name}`).toBe(call.ok);
      expect(row.error_code, `row ${index} ${call.name}`).toBe(call.code);
      expect(row.user_id).toBe(o.userId);
      if (call.owned) expect(row.page_id, `row ${index} ${call.name}`).toBe(o.pageId);
      else expect(row.page_id, `row ${index} ${call.name}`).toBeNull();
      // The row has no column that could hold content.
      expect(Object.keys(row).sort()).toEqual(
        [
          "at",
          "client_id",
          "error_code",
          "grant_id",
          "id",
          "ok",
          "page_id",
          "tool",
          "user_id",
        ].sort(),
      );
    });

    // The marker is in no activity row, in no line the connector logged, and in nothing any code
    // under it printed to the console.
    expect(written.filter(holdsMarker)).toEqual([]);
    expect(h.rt.logs.filter(holdsMarker)).toEqual([]);
    expect(console_.filter(holdsMarker)).toEqual([]);
    // A log line of the connector is the tool name and a code, nothing else.
    for (const line of h.rt.logs) {
      expect(line).toMatch(/^\[mcp\] tool=[a-z_]{1,40} ok=false code=[a-z_]{1,40}$/);
    }
    expect(h.rt.logs.length).toBe(calls.filter((call) => !call.ok).length);
  });

  it("an error sentence echoes at most 80 characters of what was sent", async () => {
    const long = `${MARK}-${"x".repeat(5_000)}`;
    for (const [name, input] of [
      ["update_entry", { entryId: o.homeId, ifRev: 1, [long]: 1 }],
      ["create_entry", { pageId: o.pageId, title: "T", slug: long }],
      ["create_entry", { pageId: o.pageId, title: "T", categories: [long] }],
      ["list_entries", { pageId: o.pageId, cursor: long }],
      ["update_content_type", { pageId: o.pageId, archivePath: long }],
      ["create_term", { pageId: o.pageId, taxonomy: "tag", name: "N", slug: long }],
    ] as const) {
      const out = await h.call(name, input, o);
      expect(out.isError, name).toBe(true);
      const text = JSON.stringify(out.raw);
      expect(text.length, name).toBeLessThan(1_500);
      expect(text, name).not.toContain("x".repeat(81));
    }
  });
});
