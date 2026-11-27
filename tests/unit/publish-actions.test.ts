import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag, revalidateTag: vi.fn(), unstable_cache: vi.fn() }));

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

const publishPageCore = vi.fn();
const publishSitePageCore = vi.fn();
const publishDesignCore = vi.fn();
vi.mock("@/lib/publish/core", () => ({ publishPageCore, publishSitePageCore, publishDesignCore }));

const cleanupMediaQuietly = vi.fn();
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly }));

const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit }));
// Wave F: the actions ask the access helper for the site's owner (rate keys, the media queue). Here
// the session user owns the page, so the owner key and the user key are one.
vi.mock("@/lib/access/server", () => ({
  siteAccessFor: async ({ siteId }: { siteId: string }) => ({
    ok: true,
    access: {
      actorId: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
      ownerId: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
      siteId,
    },
  }),
}));

const { publishPage, publishSitePage, publishDesign } = await import("@/lib/publish/actions");
type PublishExpected = import("@/lib/publish/core").PublishExpected;

const PAGE = "00000000-0000-4000-8000-0000000000B1";
const USER = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const ENTRY = "00000000-0000-4000-8000-0000000000e1";

beforeEach(() => {
  updateTag.mockClear();
  cleanupMediaQuietly.mockReset();
  getSessionUser.mockReset();
  publishPageCore.mockReset();
  publishSitePageCore.mockReset();
  publishDesignCore.mockReset();
  rateLimit.mockReset();
  rateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
});

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// M15-10 rewrote the first two tests: the module now exports three actions, and publishPage takes
// the revs the editor holds beside the id. What they guard is unchanged: no action takes a document.
describe("M2-23 publishPage is a Server Action that takes ids and revs, never a document", () => {
  it("the module is 'use server' and exports only async functions", () => {
    const text = source("src/lib/publish/actions.ts");
    expect(text.trimStart().startsWith('"use server"')).toBe(true);
    const exported = text.match(/^export (?!type\b|interface\b).*$/gm) ?? [];
    expect(exported).toHaveLength(3);
    for (const line of exported) expect(line).toMatch(/^export async function publish/);
    expect(text).toMatch(
      /^export async function publishPage\(\n  pageId: string,\n  expected\?: PublishExpected,\n\)/m,
    );
    expect(text).toMatch(
      /^export async function publishSitePage\(\n  pageId: string,\n  entryId: string,\n  expectedRev: number,\n\)/m,
    );
    expect(text).toMatch(
      /^export async function publishDesign\(\n  pageId: string,\n  expectedRev: string \| null,\n\)/m,
    );
  });

  it("its signature takes a string and revs, and no document (type test)", () => {
    expectTypeOf(publishPage).parameters.toEqualTypeOf<[string, (PublishExpected | undefined)?]>();
    expectTypeOf(publishSitePage).parameters.toEqualTypeOf<[string, string, number]>();
    expectTypeOf(publishDesign).parameters.toEqualTypeOf<[string, string | null]>();
    // @ts-expect-error a document cannot be passed
    void (() => publishPage("id", { profile: { name: "x" } }));
    // @ts-expect-error a document cannot stand in for the id
    void (() => publishPage({ profile: { name: "x" } }));
    // @ts-expect-error a document cannot stand in for the rev
    void (() => publishSitePage("id", "entry", { blocks: [] }));
    // @ts-expect-error a document cannot stand in for the rev
    void (() => publishDesign("id", { theme: {} }));
  });

  it("the gate imports the secret-key client under server-only, the action does not touch it", () => {
    const core = source("src/lib/publish/core.ts");
    expect(core).toMatch(/^import "server-only";/m);
    expect(core).toMatch(/from "@\/lib\/supabase\/admin"/);
    const action = source("src/lib/publish/actions.ts");
    expect(action).not.toMatch(/supabase\/admin/);
    expect(action).not.toMatch(/\bdraft\b.*:.*Record|\bdoc\b/);
  });
});

describe("M2-26 Publish calls updateTag, inside the action, on success only", () => {
  it("expires the page's own tag after a successful publish", async () => {
    getSessionUser.mockResolvedValue({ id: USER, email: "a@example.com" });
    publishPageCore.mockResolvedValue({ ok: true, publishedAt: "2026-10-02T01:00:00.000Z" });
    const result = await publishPage(PAGE);
    expect(result).toEqual({ ok: true, publishedAt: "2026-10-02T01:00:00.000Z" });
    expect(publishPageCore).toHaveBeenCalledWith({ pageId: PAGE, userId: USER });
    expect(updateTag).toHaveBeenCalledTimes(1);
    // Tags are case-sensitive: the id is lower-cased, as pages.id is stored.
    expect(updateTag).toHaveBeenCalledWith(`page:${PAGE.toLowerCase()}`);
  });

  it("M5-14 then works off the owner's cleanup queue, after updateTag, for the session user", async () => {
    getSessionUser.mockResolvedValue({ id: USER, email: "a@example.com" });
    publishPageCore.mockResolvedValue({ ok: true, publishedAt: "2026-10-02T01:00:00.000Z" });
    await publishPage(PAGE);
    expect(cleanupMediaQuietly).toHaveBeenCalledTimes(1);
    // Re-review finding 1: as the publisher's access (the one entry point derives the scope).
    expect(cleanupMediaQuietly).toHaveBeenCalledWith(
      { actorId: USER, ownerId: USER, siteId: PAGE.toLowerCase() },
      {},
    );
    expect(updateTag.mock.invocationCallOrder[0]!).toBeLessThan(
      cleanupMediaQuietly.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    [
      "a validation failure",
      { ok: false, reason: "invalid", errors: [{ blockId: "x", field: "url", message: "m" }] },
    ],
    ["forbidden", { ok: false, reason: "forbidden", errors: [] }],
    ["an error", { ok: false, reason: "error", errors: [] }],
  ])("does not touch the cache after %s", async (_label, result) => {
    getSessionUser.mockResolvedValue({ id: USER, email: "a@example.com" });
    publishPageCore.mockResolvedValue(result);
    expect(await publishPage(PAGE)).toEqual(result);
    expect(updateTag).not.toHaveBeenCalled();
    expect(cleanupMediaQuietly).not.toHaveBeenCalled(); // nothing was published: nothing was dropped
  });

  it("passes no user when there is no session (the gate answers unauthorized)", async () => {
    getSessionUser.mockResolvedValue(null);
    publishPageCore.mockResolvedValue({ ok: false, reason: "unauthorized", errors: [] });
    await publishPage(PAGE);
    expect(publishPageCore).toHaveBeenCalledWith({ pageId: PAGE, userId: null });
    expect(updateTag).not.toHaveBeenCalled();
    expect(cleanupMediaQuietly).not.toHaveBeenCalled();
  });
});

describe("M15-10 Publish all changes, Publish page and Publish design", () => {
  const expected: PublishExpected = { designRev: "7", entries: { [ENTRY]: 3 } };

  it("publishPage hands the revs the editor holds to the gate, with the session user", async () => {
    getSessionUser.mockResolvedValue({ id: USER });
    publishPageCore.mockResolvedValue({ ok: true, publishedAt: "2026-10-02T01:00:00.000Z" });
    await publishPage(PAGE, expected);
    expect(publishPageCore).toHaveBeenCalledWith({ pageId: PAGE, userId: USER, expected });
  });

  it("publishSitePage passes ids, the rev and the session user; the tag expires on success only", async () => {
    getSessionUser.mockResolvedValue({ id: USER });
    const ok = { ok: true, publishedAt: "2026-10-02T01:00:00.000Z", rev: 4, unchanged: false };
    publishSitePageCore.mockResolvedValue(ok);
    expect(await publishSitePage(PAGE, ENTRY, 3)).toEqual(ok);
    expect(publishSitePageCore).toHaveBeenCalledWith({
      pageId: PAGE,
      entryId: ENTRY,
      expectedRev: 3,
      userId: USER,
      source: "editor",
    });
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith(`page:${PAGE.toLowerCase()}`);
    expect(publishPageCore).not.toHaveBeenCalled();
    expect(publishDesignCore).not.toHaveBeenCalled();
  });

  it("publishDesign passes the id, the rev key and the session user; the tag expires on success only", async () => {
    getSessionUser.mockResolvedValue({ id: USER });
    publishDesignCore.mockResolvedValue({ ok: true, publishedAt: "2026-10-02T01:00:00.000Z" });
    await publishDesign(PAGE, "7");
    expect(publishDesignCore).toHaveBeenCalledWith({
      pageId: PAGE,
      expectedRev: "7",
      userId: USER,
    });
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(publishSitePageCore).not.toHaveBeenCalled();
  });

  it.each([
    ["conflict", { ok: false, reason: "conflict", errors: [], currentRev: 9 }],
    ["not_found", { ok: false, reason: "not_found", errors: [] }],
  ])("a %s answer is returned as it is and touches no cache", async (_label, result) => {
    getSessionUser.mockResolvedValue({ id: USER });
    publishSitePageCore.mockResolvedValue(result);
    publishDesignCore.mockResolvedValue(result);
    expect(await publishSitePage(PAGE, ENTRY, 3)).toEqual(result);
    expect(await publishDesign(PAGE, "7")).toEqual(result);
    expect(updateTag).not.toHaveBeenCalled();
    expect(cleanupMediaQuietly).not.toHaveBeenCalled();
  });

  it("the two new actions share Publish's rate limit and call no gate past it", async () => {
    getSessionUser.mockResolvedValue({ id: USER });
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });
    const limited = { ok: false, errors: [], reason: "rate_limited" };
    expect(await publishSitePage(PAGE, ENTRY, 3)).toEqual(limited);
    expect(await publishDesign(PAGE, "7")).toEqual(limited);
    expect(rateLimit).toHaveBeenCalledWith(`publish:${USER}`, 60, 3600);
    expect(publishSitePageCore).not.toHaveBeenCalled();
    expect(publishDesignCore).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("without a session the gates answer, with a null user and no rate count", async () => {
    getSessionUser.mockResolvedValue(null);
    const refused = { ok: false, errors: [], reason: "unauthorized" };
    publishSitePageCore.mockResolvedValue(refused);
    publishDesignCore.mockResolvedValue(refused);
    await publishSitePage(PAGE, ENTRY, 3);
    await publishDesign(PAGE, null);
    expect(publishSitePageCore).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(publishDesignCore).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("M2-26 autosave never invalidates the page cache", () => {
  it("nothing outside the publish action and the invalidate helpers touches a page tag", () => {
    // updateTag / revalidateTag appear only in src/lib/publish/{actions,invalidate}.ts.
    const out = execSync(
      `grep -rlE "updateTag|revalidateTag|revalidatePath" src --include=*.ts --include=*.tsx || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const files = out
      .split("\n")
      .filter(Boolean)
      .map((f) => f.trim())
      .sort();
    for (const file of files) {
      const text = source(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (!/\b(updateTag|revalidateTag|revalidatePath)\(/.test(text)) continue;
      expect(
        ["src/lib/publish/actions.ts", "src/lib/publish/invalidate.ts"],
        `${file} calls a cache invalidation`,
      ).toContain(file);
    }
  });
});

describe("M11-12 Publish is rate limited per account (60 an hour)", () => {
  it("counts the session user under publish:<id> with 60 per 3600 seconds", async () => {
    getSessionUser.mockResolvedValue({ id: USER, email: "a@example.com" });
    publishPageCore.mockResolvedValue({ ok: true, publishedAt: "2026-10-02T01:00:00.000Z" });
    await publishPage(PAGE);
    expect(rateLimit).toHaveBeenCalledWith(`publish:${USER}`, 60, 3600);
  });

  it("past the limit nothing is published, no tag is expired and the reason is rate_limited", async () => {
    getSessionUser.mockResolvedValue({ id: USER, email: "a@example.com" });
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });
    const result = await publishPage(PAGE);
    expect(result).toEqual({ ok: false, errors: [], reason: "rate_limited" });
    expect(publishPageCore).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
    expect(cleanupMediaQuietly).not.toHaveBeenCalled();
  });

  it("a signed-out call is refused by the gate, not counted", async () => {
    getSessionUser.mockResolvedValue(null);
    publishPageCore.mockResolvedValue({ ok: false, errors: [], reason: "unauthorized" });
    await publishPage(PAGE);
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
