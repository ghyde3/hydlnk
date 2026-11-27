import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  enable: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));
vi.mock("@/lib/publish/invalidate", () => ({
  invalidateEntry: vi.fn(),
  invalidateType: vi.fn(),
  invalidatePage: vi.fn(),
}));
vi.mock("@/lib/content/types-core", () => ({
  listTypesWithClient: (_admin: unknown, input: unknown) => mocks.list(input),
  updateTypeWithClient: (_admin: unknown, input: unknown) => mocks.update(input),
  enableTypeWithClient: (_admin: unknown, input: unknown) => mocks.enable(input),
}));

const { updateTypeAndSwitch } = await import("@/lib/content");

const actor = { userId: "11111111-1111-4111-8111-111111111111", source: "mcp" } as const;
const siteId = "22222222-2222-4222-8222-222222222222";
const before = {
  typeId: "t1",
  key: "post",
  label: "Post",
  labelPlural: "Posts",
  enabled: false,
  archivePath: "blog",
};
const refusedSwitch = {
  ok: false,
  status: 400,
  error: "path_taken",
  message: "A page uses that address.",
} as const;

/**
 * The one compensation of a combined settings-and-switch call (M16-02, M18-10): the Posts route and
 * `update_content_type` both call it. Its database path is proven through both callers
 * (`m16-posts-routes`, `m18-mcp-content-type`); here, what it puts back and the rare case where
 * putting back fails.
 */
describe("updateTypeAndSwitch", () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue({ ok: true, types: [before] });
    mocks.update.mockReset().mockImplementation(async (input: Record<string, unknown>) => ({
      ok: true,
      ...before,
      ...input,
    }));
    mocks.enable.mockReset().mockResolvedValue(refusedSwitch);
  });

  it("a refused switch puts back every setting the call changed, and answers the switch's refusal", async () => {
    const out = await updateTypeAndSwitch({
      actor,
      siteId,
      typeKey: "post",
      settings: { archivePath: "about", labelPlural: "Journal" },
      enabled: true,
    });
    expect(out).toEqual(refusedSwitch);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1]![0]).toMatchObject({
      archivePath: "blog",
      labelPlural: "Posts",
    });
    expect(mocks.update.mock.calls[1]![0]).not.toHaveProperty("label");
  });

  it("when putting back fails too, the refusal says the settings stand", async () => {
    mocks.update
      .mockImplementationOnce(async (input: Record<string, unknown>) => ({
        ok: true,
        ...before,
        ...input,
      }))
      .mockResolvedValueOnce({ ok: false, status: 403, error: "account_suspended", message: "x" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await updateTypeAndSwitch({
      actor,
      siteId,
      typeKey: "post",
      settings: { archivePath: "about" },
      enabled: true,
    });
    expect(out).toEqual({ ...refusedSwitch, settingsStand: true });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("a refused setting is the answer and the switch is never tried; a setting that changed nothing is not written back", async () => {
    mocks.update.mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: "invalid",
      message: "No.",
    });
    const refused = await updateTypeAndSwitch({
      actor,
      siteId,
      typeKey: "post",
      settings: { archivePath: "BAD" },
      enabled: true,
    });
    expect(refused).toMatchObject({ ok: false, error: "invalid" });
    expect(mocks.enable).not.toHaveBeenCalled();

    mocks.update.mockClear();
    const same = await updateTypeAndSwitch({
      actor,
      siteId,
      typeKey: "post",
      settings: { archivePath: "blog" },
      enabled: true,
    });
    expect(same).toEqual(refusedSwitch);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("a type the site does not have is not_found, and nothing is written", async () => {
    mocks.list.mockResolvedValue({ ok: true, types: [] });
    const out = await updateTypeAndSwitch({
      actor,
      siteId,
      typeKey: "post",
      settings: { label: "Note" },
      enabled: true,
    });
    expect(out).toMatchObject({ ok: false, error: "not_found" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.enable).not.toHaveBeenCalled();
  });
});
