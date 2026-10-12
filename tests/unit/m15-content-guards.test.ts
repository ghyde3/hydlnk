// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { CONTENT_STATUS, failure, mapDbError } from "@/lib/content/errors";
import { activeAccount, enabledType, ownedEntry, ownedSite } from "@/lib/content/guards";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { contentTypes, enablePost } from "./content-support";

vi.mock("server-only", () => ({}));

describe("mapDbError", () => {
  const cases: Array<[string, string]> = [
    ["HL009", "storage_full"],
    ["HL010", "entry_limit"],
    ["HL011", "type_limit"],
    ["HL012", "path_taken"],
    ["HL008", "page_limit"],
    ["HL005", "blocked_link"],
    ["23505", "slug_taken"],
    ["P0002", "not_found"],
    ["22023", "conflict"],
  ];
  it.each(cases)("%s becomes %s", (code, error) => {
    const out = mapDbError({ code, message: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe(error);
    expect(out.status).toBe(CONTENT_STATUS[error as keyof typeof CONTENT_STATUS]);
  });
  it("an unknown code becomes error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(mapDbError({ code: "XX000", message: "boom" }).error).toBe("error");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("failure carries currentRev", () => {
    expect(failure("conflict", undefined, 7)).toMatchObject({ currentRev: 7, status: 409 });
  });
});

const { run } = await stackIsUp();
describe.skipIf(!run)("guards against the local stack", () => {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  let a: TestOwner;
  let b: TestOwner;
  beforeAll(async () => {
    a = await makeOwner(admin as never, "cg-a");
    b = await makeOwner(admin as never, "cg-b");
  });
  afterAll(async () => removeOwners(admin as never, [a, b]));

  it("another user's site and a random uuid answer the same not_found", async () => {
    const other = await ownedSite(admin, a.userId, b.pageId);
    const missing = await ownedSite(admin, a.userId, "11111111-1111-4111-8111-111111111111");
    const garbage = await ownedSite(admin, a.userId, "nope");
    expect(other).toEqual(missing);
    expect(garbage).toEqual(missing);
    expect(missing).toMatchObject({ ok: false, error: "not_found", status: 404 });
    expect(await ownedSite(admin, a.userId, a.pageId)).toMatchObject({ ok: true });
  });

  it("another user's entry and a missing one answer the same not_found", async () => {
    const { page } = await contentTypes(admin, b.pageId);
    const e = await admin
      .from("content_entries")
      .insert({ site_id: b.pageId, type_id: page.id, draft: { path: "/zq-guard", blocks: [] } })
      .select("id")
      .single();
    if (e.error) throw new Error(e.error.message);
    const other = await ownedEntry(admin, a.userId, e.data.id);
    const missing = await ownedEntry(admin, a.userId, "11111111-1111-4111-8111-111111111111");
    expect(other).toEqual(missing);
    expect(missing).toMatchObject({ ok: false, error: "not_found" });
    expect(await ownedEntry(admin, b.userId, e.data.id)).toMatchObject({ ok: true });
  });

  it("a suspended account is refused, an active one passes", async () => {
    expect(await activeAccount(admin, a.userId)).toMatchObject({ ok: true });
    await admin.from("accounts").update({ suspended_at: new Date().toISOString() }).eq("id", a.userId);
    expect(await activeAccount(admin, a.userId)).toMatchObject({
      ok: false,
      error: "account_suspended",
    });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", a.userId);
  });

  it("the post type is type_disabled until enabled", async () => {
    const before = await enabledType(admin, a.pageId, "post");
    expect(before).toMatchObject({ ok: false, error: "type_disabled" });
    await enablePost(admin, a.pageId);
    expect(await enabledType(admin, a.pageId, "post")).toMatchObject({ ok: true });
  });
});
