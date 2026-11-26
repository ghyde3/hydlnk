// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  invalidatePage: vi.fn(),
  invalidateEntry: vi.fn(),
  invalidateType: vi.fn(),
}));
const core = vi.hoisted(() => ({
  publish: vi.fn(),
  unpublish: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  enable: vi.fn(),
  update: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => cache);
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));
vi.mock("@/lib/content/publish-core", () => ({
  publishEntryWithClient: core.publish,
  unpublishEntryWithClient: core.unpublish,
}));
vi.mock("@/lib/content/trash-core", () => ({
  trashEntryWithClient: core.trash,
  restoreEntryWithClient: core.restore,
  purgeEntryWithClient: vi.fn(),
}));
vi.mock("@/lib/content/types-core", () => ({
  enableTypeWithClient: core.enable,
  updateTypeWithClient: core.update,
  listTypesWithClient: vi.fn(),
}));

import {
  enableType,
  publishEntry,
  restoreEntry,
  trashEntry,
  unpublishEntry,
  updateType,
} from "@/lib/content";

/**
 * M16-09: what each writer call expires. A post expires its own entry and its type, never the whole
 * site; a page entry still expires the site; a type that is switched or moved expires the type (the
 * invalidation module adds the site). Nothing is expired after a refusal.
 */
const actor = { userId: "u", source: "editor" as const };
const input = { actor, entryId: "entry-1", expectedRev: 1 };
const post = { siteId: "site-1", typeId: "type-post", typeKey: "post" };
const page = { siteId: "site-1", typeId: "type-page", typeKey: "page" };

const WRITES = [
  ["publishEntry", publishEntry, core.publish],
  ["unpublishEntry", unpublishEntry, core.unpublish],
  ["trashEntry", trashEntry, core.trash],
  ["restoreEntry", restoreEntry, core.restore],
] as const;

describe("content writer: cache expiry per entry, type and site", () => {
  beforeEach(() => {
    for (const fn of [...Object.values(cache), ...Object.values(core)]) fn.mockReset();
  });

  for (const [name, call, mock] of WRITES) {
    it(`${name} of a post expires the entry and its type, not the site`, async () => {
      mock.mockResolvedValueOnce({ ok: true, rev: 2, ...post });
      await expect(call(input)).resolves.toMatchObject({ ok: true, rev: 2 });
      expect(cache.invalidateEntry).toHaveBeenCalledTimes(1);
      expect(cache.invalidateEntry).toHaveBeenCalledWith({
        siteId: "site-1",
        typeId: "type-post",
        typeKey: "post",
        entryId: "entry-1",
      });
      expect(cache.invalidatePage).not.toHaveBeenCalled();
      expect(cache.invalidateType).not.toHaveBeenCalled();
    });

    it(`${name} of a page entry still expires the site tag, and only it`, async () => {
      mock.mockResolvedValueOnce({ ok: true, rev: 2, ...page });
      await call(input);
      expect(cache.invalidatePage).toHaveBeenCalledTimes(1);
      expect(cache.invalidatePage).toHaveBeenCalledWith("site-1");
      expect(cache.invalidateEntry).not.toHaveBeenCalled();
      expect(cache.invalidateType).not.toHaveBeenCalled();
    });

    it(`${name} of a custom type's entry is expired like a post`, async () => {
      mock.mockResolvedValueOnce({
        ok: true,
        rev: 2,
        ...post,
        typeId: "type-r",
        typeKey: "recipes",
      });
      await call(input);
      expect(cache.invalidateEntry).toHaveBeenCalledWith({
        siteId: "site-1",
        typeId: "type-r",
        typeKey: "recipes",
        entryId: "entry-1",
      });
      expect(cache.invalidatePage).not.toHaveBeenCalled();
    });

    it(`${name} expires nothing after a refusal`, async () => {
      mock.mockResolvedValueOnce({ ok: false, status: 409, error: "conflict", message: "x" });
      await expect(call(input)).resolves.toMatchObject({ ok: false, error: "conflict" });
      for (const fn of Object.values(cache)) expect(fn).not.toHaveBeenCalled();
    });

    it(`${name}: a failing expiry is only logged, the write stands`, async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      cache.invalidateEntry.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      mock.mockResolvedValueOnce({ ok: true, rev: 2, ...post });
      await expect(call(input)).resolves.toMatchObject({ ok: true, rev: 2 });
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });
  }

  const type = {
    typeId: "type-post",
    key: "post",
    label: "Post",
    labelPlural: "Posts",
    enabled: true,
    archivePath: "blog",
  };

  it("enableType expires the type (and through it the site) of the site it was asked for", async () => {
    core.enable.mockResolvedValueOnce({ ok: true, ...type });
    await enableType({ actor, siteId: "site-1", typeKey: "post", enabled: true });
    expect(cache.invalidateType).toHaveBeenCalledTimes(1);
    expect(cache.invalidateType).toHaveBeenCalledWith({ siteId: "site-1", typeId: "type-post" });
    expect(cache.invalidateEntry).not.toHaveBeenCalled();
  });

  it("turning the blog off expires it too", async () => {
    core.enable.mockResolvedValueOnce({ ok: true, ...type, enabled: false });
    await enableType({ actor, siteId: "site-1", typeKey: "post", enabled: false });
    expect(cache.invalidateType).toHaveBeenCalledWith({ siteId: "site-1", typeId: "type-post" });
  });

  it("updateType expires the type after a new archive path", async () => {
    core.update.mockResolvedValueOnce({ ok: true, ...type, archivePath: "journal" });
    await updateType({ actor, siteId: "site-1", typeKey: "post", archivePath: "journal" });
    expect(cache.invalidateType).toHaveBeenCalledTimes(1);
    expect(cache.invalidateType).toHaveBeenCalledWith({ siteId: "site-1", typeId: "type-post" });
  });

  it("a refused enableType or updateType expires nothing", async () => {
    core.enable.mockResolvedValueOnce({ ok: false, status: 404, error: "not_found", message: "x" });
    core.update.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "path_taken",
      message: "x",
    });
    await enableType({ actor, siteId: "other", typeKey: "post", enabled: true });
    await updateType({ actor, siteId: "site-1", typeKey: "post", archivePath: "shop" });
    for (const fn of Object.values(cache)) expect(fn).not.toHaveBeenCalled();
  });

  it("a failing type expiry is only logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    cache.invalidateType.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    core.enable.mockResolvedValueOnce({ ok: true, ...type });
    await expect(
      enableType({ actor, siteId: "site-1", typeKey: "post", enabled: true }),
    ).resolves.toMatchObject({ ok: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
