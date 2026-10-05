import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M11-04 step 7 and M11-08: creating and deleting a sub-page, the real cores with the secret-key
 * client against the local Supabase stack (the real ownership checks, the real HL008 trigger).
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M11-04 sub-page create and delete (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/site-pages/sub-pages-core");
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/site-pages/sub-pages-core");
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  async function owner(label: string, plan: "free" | "pro" | "studio" = "free") {
    const made = await makeOwner(admin, label, undefined, plan);
    owners.push(made);
    return made;
  }
  const create = (
    o: TestOwner,
    body: { title?: unknown; path?: unknown } = {},
    siteId = o.pageId,
  ) => core.createSubPageWithClient(admin as never, { userId: o.userId, siteId, ...body });
  const count = async (siteId: string) => {
    const { count: n } = await admin
      .from("site_pages")
      .select("id", { count: "exact", head: true })
      .eq("page_id", siteId);
    return n ?? 0;
  };

  it("creates 'New page' with a free path and an empty draft", async () => {
    const o = await owner("c1");
    const made = await create(o);
    expect(made).toMatchObject({
      ok: true,
      draft: { path: "new-page", title: "New page", blocks: [] },
    });
    const second = await create(o);
    expect(second).toMatchObject({ ok: true, draft: { path: "new-page-2", title: "New page" } });
    expect(await count(o.pageId)).toBe(2);
  });

  it("a given title makes the suggested path; a blank title is New page; markup stays text", async () => {
    const o = await owner("c2", "pro");
    expect(await create(o, { title: "  Our Menu  " })).toMatchObject({
      ok: true,
      draft: { path: "our-menu", title: "Our Menu" },
    });
    expect(await create(o, { title: "   " })).toMatchObject({
      ok: true,
      draft: { title: "New page" },
    });
    expect(await create(o, { title: "<b>x</b>" })).toMatchObject({
      ok: true,
      draft: { title: "<b>x</b>" },
    });
  });

  it("a given path is checked: format 422, reserved 422, another page's path 409", async () => {
    const o = await owner("c3", "pro");
    expect(await create(o, { path: "Bad Path" })).toMatchObject({
      ok: false,
      status: 422,
      error: "path_invalid",
    });
    expect(await create(o, { path: "og" })).toMatchObject({
      ok: false,
      status: 422,
      error: "path_invalid",
    });
    expect(await create(o, { path: "menu" })).toMatchObject({ ok: true, draft: { path: "menu" } });
    expect(await create(o, { path: "menu" })).toMatchObject({
      ok: false,
      status: 409,
      error: "path_taken",
    });
  });

  it("a path another page is live at is taken even when its draft moved on", async () => {
    const o = await owner("c4", "pro");
    const made = await create(o, { path: "old" });
    if (!made.ok) throw new Error("setup");
    const published = { path: "old", title: "Old", description: "", blocks: [] };
    const upd = await admin
      .from("site_pages")
      .update({
        published,
        published_at: new Date().toISOString(),
        draft: { ...made.draft, path: "new" },
      })
      .eq("id", made.id);
    expect(upd.error).toBeNull();
    expect(await create(o, { path: "old" })).toMatchObject({ ok: false, status: 409 });
  });

  it("Free stops at Home and 2 more with 403 page_limit and the plan's message; nothing is written", async () => {
    const o = await owner("lim");
    expect((await create(o)).ok).toBe(true);
    expect((await create(o)).ok).toBe(true);
    const third = await create(o);
    expect(third).toMatchObject({
      ok: false,
      status: 403,
      error: "page_limit",
      message: "Free includes 3 pages per site, Home and 2 more. Pro includes 10.",
    });
    expect(await count(o.pageId)).toBe(2);
  });

  it("Pro stops at 10 pages with Home counted", async () => {
    const o = await owner("pro10", "pro");
    for (let i = 0; i < 9; i += 1) expect((await create(o)).ok).toBe(true);
    expect(await create(o)).toMatchObject({
      ok: false,
      status: 403,
      error: "page_limit",
      message: "You’ve used 10 of 10 pages on this site. Studio includes unlimited pages.",
    });
  });

  it("another user's site, an unknown id and a malformed id are all 404 and write nothing", async () => {
    const a = await owner("own-a");
    const b = await owner("own-b");
    expect(await create(b, {}, a.pageId)).toMatchObject({
      ok: false,
      status: 404,
      error: "not_found",
    });
    expect(await create(b, {}, "00000000-0000-4000-8000-000000000000")).toMatchObject({
      status: 404,
    });
    expect(await create(b, {}, "not-a-uuid")).toMatchObject({ status: 404 });
    expect(await count(a.pageId)).toBe(0);
  });

  it("a suspended owner can neither create nor delete", async () => {
    const o = await owner("susp");
    const made = await create(o);
    if (!made.ok) throw new Error("setup");
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", o.userId);
    expect(await create(o)).toMatchObject({ ok: false, status: 403, error: "account_suspended" });
    const del = await core.deleteSubPageWithClient(admin as never, {
      userId: o.userId,
      siteId: o.pageId,
      subPageId: made.id,
    });
    expect(del).toMatchObject({ ok: false, status: 403, error: "account_suspended" });
    expect(await count(o.pageId)).toBe(1);
  });

  it("delete removes the row and the id from Home's draft menu, leaving rev and the rest alone", async () => {
    const o = await owner("del");
    const a = await create(o, { title: "Alpha" });
    const b = await create(o, { title: "Beta" });
    if (!a.ok || !b.ok) throw new Error("setup");
    const home = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    const draft = {
      ...(home.data!.draft as object),
      rev: 7,
      nav: { show: true, items: [a.id, b.id] },
    };
    await admin.from("pages").update({ draft }).eq("id", o.pageId);

    const del = await core.deleteSubPageWithClient(admin as never, {
      userId: o.userId,
      siteId: o.pageId,
      subPageId: a.id,
    });
    expect(del).toMatchObject({ ok: true, id: a.id, siteId: o.pageId });
    expect(await count(o.pageId)).toBe(1);
    const after = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    expect(after.data!.draft).toMatchObject({ rev: 7, nav: { show: true, items: [b.id] } });
    expect((after.data!.draft as { profile: unknown }).profile).toEqual(
      (home.data!.draft as { profile: unknown }).profile,
    );
  });

  it("delete takes the menu entry out whatever the case of the id it was given (M11-12)", async () => {
    const o = await owner("del-case");
    const a = await create(o, { title: "Alpha" });
    const b = await create(o, { title: "Beta" });
    if (!a.ok || !b.ok) throw new Error("setup");
    const home = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    await admin
      .from("pages")
      .update({
        draft: { ...(home.data!.draft as object), nav: { show: true, items: [a.id, b.id] } },
      })
      .eq("id", o.pageId);

    const del = await core.deleteSubPageWithClient(admin as never, {
      userId: o.userId,
      siteId: o.pageId,
      subPageId: a.id.toUpperCase(),
    });
    expect(del).toMatchObject({ ok: true });
    const after = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    expect(after.data!.draft).toMatchObject({ nav: { show: true, items: [b.id] } });
  });

  it("delete leaves a Home draft with no menu untouched", async () => {
    const o = await owner("del2");
    const a = await create(o);
    if (!a.ok) throw new Error("setup");
    const before = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    await core.deleteSubPageWithClient(admin as never, {
      userId: o.userId,
      siteId: o.pageId,
      subPageId: a.id,
    });
    const after = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    expect(after.data!.draft).toEqual(before.data!.draft);
  });

  it("delete refuses another user's page and a page of another site, and deletes nothing", async () => {
    const a = await owner("dx-a");
    const b = await owner("dx-b");
    const pa = await create(a);
    if (!pa.ok) throw new Error("setup");
    // b names a's site, and b names its own site with a's page id.
    expect(
      await core.deleteSubPageWithClient(admin as never, {
        userId: b.userId,
        siteId: a.pageId,
        subPageId: pa.id,
      }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await core.deleteSubPageWithClient(admin as never, {
        userId: b.userId,
        siteId: b.pageId,
        subPageId: pa.id,
      }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await core.deleteSubPageWithClient(admin as never, {
        userId: a.userId,
        siteId: a.pageId,
        subPageId: "nope",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await count(a.pageId)).toBe(1);
  });
});
