// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createEntryWithClient, updateEntryWithClient } from "@/lib/content/entries-core";
import { markdownUrls } from "@/lib/content/blocklist";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { contentTypes, enablePost } from "./content-support";

vi.mock("server-only", () => ({}));

describe("markdownUrls", () => {
  it("finds links, images, reference links and raw html addresses", () => {
    const body = [
      "[a](https://a.example/x) ![i](https://i.example/p.png)",
      "- item [b](https://b.example)",
      "[ref][r]",
      '<a href="https://h.example">h</a>',
      "",
      "[r]: https://r.example",
    ].join("\n");
    expect(markdownUrls(body).sort()).toEqual(
      [
        "https://a.example/x",
        "https://b.example",
        "https://h.example",
        "https://i.example/p.png",
        "https://r.example",
      ].sort(),
    );
  });
});

const { run } = await stackIsUp();
describe.skipIf(!run)("create and update an entry", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];
  let a: TestOwner;
  let b: TestOwner;
  const actor = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });
  const page = (path: string) => ({ path, title: "T", description: "", blocks: [] });

  beforeAll(async () => {
    a = await makeOwner(admin as never, "ce-a");
    b = await makeOwner(admin as never, "ce-b");
    owners.push(a, b);
  });
  afterAll(async () => removeOwners(admin as never, owners));

  const create = (o: TestOwner, typeKey: string, draft: unknown) =>
    createEntryWithClient(admin, { actor: actor(o), siteId: o.pageId, typeKey, draft });

  it("a disabled post type gives type_disabled", async () => {
    expect(await create(a, "post", { title: "x" })).toMatchObject({
      ok: false,
      error: "type_disabled",
    });
  });

  it("text Postgres can't store gives invalid, not a 500", async () => {
    await enablePost(admin, a.pageId);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await create(a, "post", { title: "a\u0000b" })).toMatchObject({
      ok: false,
      error: "invalid",
      status: 422,
    });
    expect(await create(a, "post", { title: "t", body: "x\ud800y" })).toMatchObject({
      ok: false,
      error: "invalid",
    });
    spy.mockRestore();
  });

  it("create, then update at rev 1 gives rev 2; a stale rev conflicts and writes nothing", async () => {
    await enablePost(admin, a.pageId);
    const made = await create(a, "post", { title: "First" });
    expect(made).toMatchObject({ ok: true, rev: 1 });
    if (!made.ok) return;
    const saved = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "Second" },
    });
    expect(saved).toEqual({ ok: true, rev: 2, unchanged: false });
    const stale = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "Third" },
    });
    expect(stale).toMatchObject({ ok: false, error: "conflict", status: 409, currentRev: 2 });
    const row = await admin.from("content_entries").select("draft, rev").eq("id", made.id).single();
    expect(row.data).toMatchObject({ draft: { title: "Second" }, rev: 2 });
  });

  it("an unchanged draft is ok, unchanged, and writes nothing", async () => {
    const made = await create(a, "post", { title: "Same", body: "b" });
    if (!made.ok) throw new Error("create failed");
    const out = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { body: "b", title: "Same" },
    });
    expect(out).toEqual({ ok: true, rev: 1, unchanged: true });
  });

  it("an invalid draft is refused with issues", async () => {
    const out = await create(a, "post", { title: 5 });
    expect(out).toMatchObject({ ok: false, error: "invalid", status: 422 });
    expect(out.ok ? [] : out.issues).not.toHaveLength(0);
  });

  it("another user's entry and a random uuid both give not_found", async () => {
    const made = await create(a, "post", { title: "Mine" });
    if (!made.ok) throw new Error("create failed");
    const other = await updateEntryWithClient(admin, {
      actor: actor(b),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "Stolen" },
    });
    const missing = await updateEntryWithClient(admin, {
      actor: actor(b),
      entryId: "11111111-1111-4111-8111-111111111111",
      expectedRev: 1,
      draft: { title: "x" },
    });
    expect(other).toEqual(missing);
    expect(missing).toMatchObject({ ok: false, error: "not_found" });
  });

  it("a trashed entry gives not_found", async () => {
    const made = await create(a, "post", { title: "Bin" });
    if (!made.ok) throw new Error("create failed");
    await admin
      .from("content_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", made.id);
    const out = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "x" },
    });
    expect(out).toMatchObject({ ok: false, error: "not_found" });
  });

  it("a post body that links to a blocked host gives blocked_link", async () => {
    await admin.from("blocked_domains").upsert({ domain: "zq-blocked.example" } as never);
    const out = await create(a, "post", { body: "[x](https://zq-blocked.example/p)" });
    expect(out).toMatchObject({ ok: false, error: "blocked_link" });
    await admin.from("blocked_domains").delete().eq("domain", "zq-blocked.example");
  });

  it("a suspended owner gives account_suspended", async () => {
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", b.userId);
    await enablePost(admin, b.pageId);
    expect(await create(b, "post", { title: "x" })).toMatchObject({
      ok: false,
      error: "account_suspended",
    });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", b.userId);
  });

  it("a page entry whose draft path clashes gives path_taken, on create and on update", async () => {
    const first = await create(a, "page", page("/zq-clash"));
    expect(first).toMatchObject({ ok: true });
    expect(await create(a, "page", page("/zq-clash"))).toMatchObject({
      ok: false,
      error: "path_taken",
      status: 409,
    });
    const other = await create(a, "page", page("/zq-other"));
    if (!other.ok) throw new Error("create failed");
    const out = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: other.id,
      expectedRev: 1,
      draft: page("/zq-clash"),
    });
    expect(out).toMatchObject({ ok: false, error: "path_taken" });
  });

  it("the 26th post on Free gives entry_limit", async () => {
    const o = await makeOwner(admin as never, "ce-limit");
    owners.push(o);
    await enablePost(admin, o.pageId);
    const { post } = await contentTypes(admin, o.pageId);
    const rows = Array.from({ length: 25 }, (_, i) => ({
      site_id: o.pageId,
      type_id: post.id,
      draft: { title: `p${i}` },
    }));
    const seeded = await admin.from("content_entries").insert(rows);
    expect(seeded.error).toBeNull();
    expect(await create(o, "post", { title: "26" })).toMatchObject({
      ok: false,
      error: "entry_limit",
    });
  });

  it("a first save records a revision; a second within 10 minutes does not", async () => {
    const made = await create(a, "post", { title: "Rev" });
    if (!made.ok) throw new Error("create failed");
    const count = async () =>
      (await admin.from("content_entry_revisions").select("rev").eq("entry_id", made.id)).data
        ?.length;
    await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "Rev 2" },
    });
    expect(await count()).toBe(1);
    await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 2,
      draft: { title: "Rev 3" },
    });
    expect(await count()).toBe(1);
    // The newest revision is now older than 10 minutes: the next save records again.
    await admin
      .from("content_entry_revisions")
      .update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      .eq("entry_id", made.id);
    await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 3,
      draft: { title: "Rev 4" },
    });
    expect(await count()).toBe(2);
  });
});
