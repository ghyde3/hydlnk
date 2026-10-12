// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { decodeCursor, encodeCursor } from "@/lib/content/cursor";
import { getEntryWithClient, listEntriesWithClient } from "@/lib/content/query-core";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { contentTypes, enablePost } from "./content-support";

vi.mock("server-only", () => ({}));

describe("list cursor", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("round-trips", () => {
    expect(decodeCursor(encodeCursor('Hello, "x"', id))).toEqual(['Hello, "x"', id]);
    expect(decodeCursor(encodeCursor(null, id))).toEqual([null, id]);
  });
  it("a tampered cursor is null", () => {
    const good = encodeCursor("a", id);
    expect(decodeCursor(good.slice(0, -3) + "!!!")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(42)).toBeNull();
    expect(
      decodeCursor(Buffer.from(JSON.stringify(["a", "not-a-uuid"])).toString("base64url")),
    ).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ a: 1 })).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("nope").toString("base64url"))).toBeNull();
  });
});

const { run } = await stackIsUp();
describe.skipIf(!run)("get and list entries", () => {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const owners: TestOwner[] = [];
  let a: TestOwner;
  let b: TestOwner;
  let termId: string;
  const actor = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });
  const ids = {
    published: new Set<string>(),
    draft: new Set<string>(),
    trashed: new Set<string>(),
  };
  const linked = new Set<string>();

  beforeAll(async () => {
    a = await makeOwner(admin as never, "cl-a", undefined, "pro");
    b = await makeOwner(admin as never, "cl-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
    const { post } = await contentTypes(admin, a.pageId);
    const base = Date.parse("2026-01-01T00:00:00Z");
    const rows = Array.from({ length: 130 }, (_, i) => {
      const title = `Post ${i % 25}${i === 7 ? " 50% off" : ""}`;
      const draft = { title, slug: `p-${i}` };
      const pub = i < 60;
      return {
        site_id: a.pageId,
        type_id: post.id,
        draft,
        ...(pub
          ? { published: draft, published_at: new Date(base + (i % 7) * 60000).toISOString() }
          : {}),
        ...(i >= 110 ? { deleted_at: new Date().toISOString() } : {}),
      };
    });
    const inserted = await admin
      .from("content_entries")
      .insert(rows as never)
      .select("id, draft");
    if (inserted.error) throw new Error(inserted.error.message);
    for (const r of inserted.data) {
      const i = Number((r.draft as { slug: string }).slug.slice(2));
      (i >= 110 ? ids.trashed : i < 60 ? ids.published : ids.draft).add(r.id);
      if (i < 5 || (i >= 60 && i < 62)) linked.add(r.id);
    }
    const term = await admin
      .from("content_terms")
      .insert({
        site_id: a.pageId,
        type_id: post.id,
        taxonomy: "category",
        name: "News",
        slug: "news",
      } as never)
      .select("id")
      .single();
    if (term.error) throw new Error(term.error.message);
    termId = term.data.id;
    const links = await admin
      .from("content_entry_terms")
      .insert([...linked].map((entry_id) => ({ entry_id, term_id: termId })));
    if (links.error) throw new Error(links.error.message);
  });
  afterAll(async () => removeOwners(admin as never, owners));

  const list = (o: TestOwner, extra: Record<string, unknown> = {}) =>
    listEntriesWithClient(admin, {
      actor: actor(o),
      siteId: o.pageId,
      typeKey: "post",
      ...extra,
    } as never);

  async function pageAll(extra: Record<string, unknown>) {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const out = await list(a, { ...extra, limit: 17, cursor });
      if (!out.ok) throw new Error(out.error);
      seen.push(...out.items.map((i) => i.id));
      if (!out.nextCursor) return { seen, out };
      cursor = out.nextCursor;
    }
    throw new Error("did not end");
  }

  it("limit 500 returns 100, and the default is 20", async () => {
    const big = await list(a, { limit: 500 });
    expect(big).toMatchObject({ ok: true });
    if (big.ok) {
      expect(big.items).toHaveLength(100);
      expect(big.nextCursor).not.toBeNull();
    }
    const def = await list(a);
    if (def.ok) expect(def.items).toHaveLength(20);
  });

  for (const sort of ["published_at", "updated_at", "title"] as const) {
    for (const order of [undefined, "asc", "desc"] as const) {
      it(`paging by ${sort} ${order ?? "default"} visits every entry once`, async () => {
        const { seen } = await pageAll({ sort, order, status: "all" });
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toHaveLength(130);
      });
    }
  }

  it("sorts by title ascending by default, ties broken by id", async () => {
    const out = await list(a, { sort: "title", status: "all", limit: 100 });
    if (!out.ok) throw new Error("x");
    for (let i = 1; i < out.items.length; i++) {
      const prev = out.items[i - 1]!;
      const cur = out.items[i]!;
      expect(prev.title === cur.title ? prev.id < cur.id : true).toBe(true);
    }
    expect(out.items[0]!.title).toBe("Post 0");
  });

  it("published_at sorts newest first and puts entries without a date last", async () => {
    const out = await list(a, { sort: "published_at", status: "all", limit: 100 });
    if (!out.ok) throw new Error("x");
    const dates = out.items.map((i) => i.publishedAt);
    const firstNull = dates.indexOf(null);
    expect(firstNull).toBe(60);
    const real = dates.slice(0, 60) as string[];
    expect(real).toEqual([...real].sort().reverse());
  });

  it("the status filter separates draft, published and trashed", async () => {
    const got = async (status: string) => new Set((await pageAll({ status })).seen);
    expect(await got("published")).toEqual(ids.published);
    expect(await got("draft")).toEqual(ids.draft);
    expect(await got("trashed")).toEqual(ids.trashed);
    const dflt = await pageAll({});
    expect(new Set(dflt.seen)).toEqual(new Set([...ids.published, ...ids.draft]));
  });

  it("the term filter returns only linked entries", async () => {
    const { seen } = await pageAll({ termId, status: "published" });
    expect(new Set(seen)).toEqual(new Set([...linked].filter((id) => ids.published.has(id))));
    const all = await pageAll({ termId });
    expect(new Set(all.seen)).toEqual(linked);
  });

  it("q matches a title literally, % and _ included", async () => {
    const pct = await pageAll({ q: "50%", status: "all" });
    expect(pct.seen).toHaveLength(1);
    expect((await pageAll({ q: "%", status: "all" })).seen).toHaveLength(1);
    expect((await pageAll({ q: "_", status: "all" })).seen).toHaveLength(0);
    const ci = await pageAll({ q: "post 24", status: "all" });
    expect(ci.seen.length).toBeGreaterThan(0);
  });

  it("a bad cursor, sort or status gives invalid", async () => {
    expect(await list(a, { cursor: "garbage" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await list(a, { sort: "rev" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await list(a, { status: "x" })).toMatchObject({ ok: false, error: "invalid" });
    const date = encodeCursor("not a date", "11111111-1111-4111-8111-111111111111");
    expect(await list(a, { sort: "updated_at", cursor: date })).toMatchObject({ error: "invalid" });
  });

  it("another user's site, an unknown type and a non-uuid site give not_found", async () => {
    expect(await list(b, { siteId: a.pageId })).toMatchObject({ ok: false, error: "not_found" });
    expect(await list(a, { typeKey: "nope" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await list(a, { siteId: "x" })).toMatchObject({ ok: false, error: "not_found" });
  });

  it("a suspended owner can still read", async () => {
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", b.userId);
    expect(await list(b)).toMatchObject({ ok: true });
  });

  it("get returns the draft, published copy, rev, status and dates; others get not_found", async () => {
    const pubId = [...ids.published][0]!;
    const got = await getEntryWithClient(admin, { actor: actor(a), entryId: pubId });
    expect(got).toMatchObject({
      ok: true,
      id: pubId,
      rev: 1,
      status: "published",
      siteId: a.pageId,
    });
    if (got.ok) {
      expect(got.draft).toBeTruthy();
      expect(got.published).toBeTruthy();
      expect(got.publishedAt).toEqual(expect.any(String));
    }
    const trId = [...ids.trashed][0]!;
    expect(await getEntryWithClient(admin, { actor: actor(a), entryId: trId })).toMatchObject({
      ok: true,
      status: "trashed",
    });
    const drId = [...ids.draft][0]!;
    expect(await getEntryWithClient(admin, { actor: actor(a), entryId: drId })).toMatchObject({
      status: "draft",
      published: null,
    });
    expect(await getEntryWithClient(admin, { actor: actor(b), entryId: pubId })).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });
});
