import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const commitSubPage = vi.fn();
const writeMenuChange = vi.fn();
vi.mock("@/lib/mcp/commit", () => ({ commitSubPage: (...a: unknown[]) => commitSubPage(...a) }));
vi.mock("@/lib/mcp/tools/menu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/tools/menu")>()),
  writeMenuChange: (...a: unknown[]) => writeMenuChange(...a),
}));

import { ToolFailure } from "@/lib/mcp/errors";
import { updatePageSettings } from "@/lib/mcp/tools/update-page-settings";

/**
 * M12-05 review: update_page_settings is all or nothing. When the Home menu write fails after the
 * page's own write succeeded, the page is put back (guarded by the rev the first write made) and the
 * error says nothing was changed; when the restore fails too, the error says what was saved.
 */

const SUB = "6f1c2b9e-4a53-4f7d-9d80-1a2b3c4d5e61";
const before = { path: "old", title: "Old", description: "", blocks: [] };

const call = {
  admin: {},
  userId: "u1",
  page: { id: "p1", draft: { version: 1, rev: 1, nav: { show: true, items: [] }, blocks: [] } },
  subPage: { id: SUB, rev: 100 },
  deps: {},
  defer: () => {},
  now: () => new Date(),
} as never;

/** commitSubPage stand-in: runs the callback on `before` and reports the rev it "wrote". */
function fakeCommit(rev: number) {
  return async (
    _call: unknown,
    _ifRev: unknown,
    change: (d: typeof before) => { kind: string; doc?: typeof before; value: unknown },
  ) => {
    const out = change(before);
    return { rev, unchanged: out.kind === "unchanged", doc: out.doc ?? before, value: out.value };
  };
}

const args = { pageId: "p1", subPageId: SUB, title: "New", inMenu: true } as never;

beforeEach(() => {
  commitSubPage.mockReset();
  writeMenuChange.mockReset();
});

describe("update_page_settings failure after the first write", () => {
  it("puts the page back with a write guarded by the new rev, and says nothing changed", async () => {
    commitSubPage.mockImplementationOnce(fakeCommit(200)).mockImplementationOnce(fakeCommit(300));
    writeMenuChange.mockRejectedValue(new Error("db down"));
    const error = await updatePageSettings.handler(args, call).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolFailure);
    expect((error as ToolFailure).code).toBe("server_error");
    expect((error as ToolFailure).message).toMatch(/nothing was changed/i);
    expect(commitSubPage).toHaveBeenCalledTimes(2);
    // The restore is guarded by the rev the first write made, and writes the original document.
    const [, guard, change] = commitSubPage.mock.calls[1]!;
    expect(guard).toBe(200);
    expect(change({})).toEqual({ kind: "write", doc: before, value: null });
  });

  it("a Home conflict is reported as a conflict, still with nothing changed", async () => {
    commitSubPage.mockImplementationOnce(fakeCommit(200)).mockImplementationOnce(fakeCommit(300));
    writeMenuChange.mockRejectedValue(new ToolFailure("conflict", "x"));
    const error = (await updatePageSettings
      .handler(args, call)
      .catch((e: unknown) => e)) as ToolFailure;
    expect(error.code).toBe("conflict");
    expect(error.message).toMatch(/nothing was changed/i);
  });

  it("when the restore fails too, the error says which part was saved", async () => {
    commitSubPage
      .mockImplementationOnce(fakeCommit(200))
      .mockRejectedValueOnce(new ToolFailure("conflict", "edited meanwhile"));
    writeMenuChange.mockRejectedValue(new Error("db down"));
    const error = (await updatePageSettings
      .handler(args, call)
      .catch((e: unknown) => e)) as ToolFailure;
    expect(error.code).toBe("server_error");
    expect(error.message).toMatch(/title, description or path was updated/);
    expect(error.message).toMatch(/menu was not changed/);
    expect(error.message).not.toMatch(/nothing was changed/i);
  });

  it("with no page write before it, a failed menu write changes nothing and restores nothing", async () => {
    writeMenuChange.mockRejectedValue(new Error("db down"));
    const error = (await updatePageSettings
      .handler({ pageId: "p1", subPageId: SUB, inMenu: true } as never, call)
      .catch((e: unknown) => e)) as ToolFailure;
    expect(commitSubPage).not.toHaveBeenCalled();
    expect(error.message).toMatch(/nothing was changed/i);
  });

  it("success is unchanged: both writes, no restore", async () => {
    commitSubPage.mockImplementationOnce(fakeCommit(200));
    writeMenuChange.mockResolvedValue({ rev: 7, changed: true, nav: { show: true, items: [SUB] } });
    const out = await updatePageSettings.handler(args, call);
    expect(commitSubPage).toHaveBeenCalledTimes(1);
    expect(out.data).toMatchObject({ rev: 200, homeRev: 7, inMenu: true, menuPosition: 0 });
  });
});
