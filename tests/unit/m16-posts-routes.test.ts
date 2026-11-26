// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { postLimitMessage, TERM_LIMIT_MESSAGE } from "@/lib/limits/messages";
import type { Database } from "@/lib/supabase/database.types";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

/**
 * The app routes of the Posts screen and the post editor (M16-02, M16-12, M16-14, M16-15), against
 * the local database. Every route: a session, the app Origin, JSON where it takes a body, and
 * `no-store`; another account's site, entry or term answers the same not-found as a missing one; a
 * page entry is refused on the post routes; limits come from the database.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  },
}));

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  invalidateEntry: vi.fn(),
  invalidateType: vi.fn(),
  invalidatePage: vi.fn(),
  admin: undefined as unknown,
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("@/lib/publish/invalidate", () => ({
  invalidateEntry: mocks.invalidateEntry,
  invalidateType: mocks.invalidateType,
  invalidatePage: mocks.invalidatePage,
}));

const { run } = await stackIsUp();

const BASE = "http://app.localhost:3000/api/pages";
const ROUTES = {
  types: () => import("@/app/(editor)/app/api/pages/[id]/types/route"),
  typePost: () => import("@/app/(editor)/app/api/pages/[id]/types/post/route"),
  posts: () => import("@/app/(editor)/app/api/pages/[id]/posts/route"),
  entry: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/route"),
  publish: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/publish/route"),
  unpublish: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/unpublish/route"),
  trash: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/trash/route"),
  restore: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/restore/route"),
  terms: () => import("@/app/(editor)/app/api/pages/[id]/terms/route"),
  term: () => import("@/app/(editor)/app/api/pages/[id]/terms/[termId]/route"),
  draft: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/draft/route"),
  revisions: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/revisions/route"),
  expire: () => import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/expire/route"),
} as const;
type RouteName = keyof typeof ROUTES;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface CallOptions {
  body?: unknown;
  raw?: string;
  origin?: string;
  contentType?: string | null;
  query?: string;
}

async function call(
  name: RouteName,
  method: Method,
  params: Record<string, string>,
  opts: CallOptions = {},
) {
  const mod = (await ROUTES[name]()) as unknown as Record<
    string,
    (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
  >;
  const handler = mod[method];
  if (!handler) throw new Error(`${name} has no ${method}`);
  const hasBody = method !== "GET" && (opts.body !== undefined || opts.raw !== undefined);
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  if (method !== "GET" && opts.contentType !== null) {
    headers["content-type"] = opts.contentType ?? "application/json";
  }
  const request = new Request(`${BASE}/${params.id}/x${opts.query ?? ""}`, {
    method,
    headers,
    ...(hasBody ? { body: opts.raw ?? JSON.stringify(opts.body) } : {}),
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  return {
    status: response.status,
    cache: response.headers.get("cache-control"),
    json: (await response.json()) as Record<string, unknown>,
  };
}

describe.skipIf(!run)("the Posts app routes", () => {
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
  let postA: string;
  let postB: string;
  let pageEntryA: string;
  let termB: string;

  const typeId = async (siteId: string, key: string) =>
    (await admin.from("content_types").select("id").eq("site_id", siteId).eq("key", key).single())
      .data!.id;
  const row = async (id: string) => {
    const found = await admin
      .from("content_entries")
      .select("rev, draft, published, deleted_at")
      .eq("id", id)
      .single();
    if (found.error) throw new Error(found.error.message);
    return { ...found.data, rev: Number(found.data.rev) };
  };
  const insertPost = async (owner: TestOwner, draft: Record<string, unknown>) => {
    const made = await admin
      .from("content_entries")
      .insert({
        site_id: owner.pageId,
        type_id: await typeId(owner.pageId, "post"),
        draft: draft as never,
      })
      .select("id")
      .single();
    if (made.error) throw new Error(made.error.message);
    return made.data.id;
  };
  const as = (owner: TestOwner) => mocks.getSessionUser.mockResolvedValue({ id: owner.userId });

  beforeAll(async () => {
    mocks.admin = admin;
    a = await makeOwner(admin as never, "pr-a");
    b = await makeOwner(admin as never, "pr-b");
    owners.push(a, b);
    for (const owner of [a, b]) {
      const on = await admin
        .from("content_types")
        .update({ enabled: true })
        .eq("site_id", owner.pageId)
        .eq("key", "post");
      if (on.error) throw new Error(on.error.message);
    }
    postA = await insertPost(a, { title: "Mine", slug: "mine", body: "Hello" });
    postB = await insertPost(b, { title: "Theirs", slug: "theirs", body: "Secret" });
    const page = await admin
      .from("content_entries")
      .insert({
        site_id: a.pageId,
        type_id: await typeId(a.pageId, "page"),
        draft: { path: "about", title: "About", description: "", blocks: [] } as never,
      })
      .select("id")
      .single();
    if (page.error) throw new Error(page.error.message);
    pageEntryA = page.data.id;
    const term = await admin
      .from("content_terms")
      .insert({
        site_id: b.pageId,
        type_id: await typeId(b.pageId, "post"),
        taxonomy: "tag",
        name: "Theirs",
        slug: "theirs",
      })
      .select("id")
      .single();
    if (term.error) throw new Error(term.error.message);
    termB = term.data.id;
  }, 60_000);
  afterAll(async () => removeOwners(admin as never, owners));
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
    as(a);
    mocks.invalidateEntry.mockClear();
    mocks.invalidateType.mockClear();
  });

  /** One probe per route: [name, method, params, body]. */
  const everyRoute = (): Array<[RouteName, Method, Record<string, string>, unknown?]> => [
    ["types", "GET", { id: a.pageId }],
    ["typePost", "POST", { id: a.pageId }, { enabled: true }],
    ["posts", "GET", { id: a.pageId }],
    ["posts", "POST", { id: a.pageId }, {}],
    ["entry", "GET", { id: a.pageId, entryId: postA }],
    ["publish", "POST", { id: a.pageId, entryId: postA }, { rev: 1 }],
    ["unpublish", "POST", { id: a.pageId, entryId: postA }, { rev: 1 }],
    ["trash", "POST", { id: a.pageId, entryId: postA }, { rev: 1 }],
    ["restore", "POST", { id: a.pageId, entryId: postA }, { rev: 1 }],
    ["terms", "GET", { id: a.pageId }],
    ["terms", "POST", { id: a.pageId }, { taxonomy: "tag", name: "X" }],
    ["term", "PATCH", { id: a.pageId, termId: termB }, { name: "Y" }],
    ["term", "DELETE", { id: a.pageId, termId: termB }],
  ];

  it("every route answers 401 without a session, with no-store, and writes nothing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const before = await row(postA);
    for (const [name, method, params, body] of everyRoute()) {
      const out = await call(name, method, params, { body });
      expect([name, method, out.status]).toEqual([name, method, 401]);
      expect(out.cache).toBe("no-store");
    }
    expect(await row(postA)).toEqual(before);
  });

  it("every route refuses a foreign Origin with 403", async () => {
    const before = await row(postA);
    for (const [name, method, params, body] of everyRoute()) {
      const out = await call(name, method, params, { body, origin: "https://evil.example" });
      expect([name, method, out.status, out.json.error]).toEqual([
        name,
        method,
        403,
        "forbidden_origin",
      ]);
      expect(out.cache).toBe("no-store");
    }
    expect(await row(postA)).toEqual(before);
  });

  it("every route that takes a body wants JSON: 415 otherwise, 400 for a broken body", async () => {
    for (const [name, method, params] of everyRoute()) {
      if (method === "GET" || method === "DELETE") continue;
      const typed = await call(name, method, params, { raw: "a=1", contentType: "text/plain" });
      expect([name, typed.status]).toEqual([name, 415]);
      const broken = await call(name, method, params, { raw: "{nope" });
      expect([name, broken.status]).toEqual([name, 400]);
    }
  });

  it("another account's site is the same not-found as a missing one, on every route", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const siteId of [b.pageId, missing, "nope"]) {
      const probes: Array<[RouteName, Method, Record<string, string>, unknown?]> = [
        ["types", "GET", { id: siteId }],
        ["typePost", "POST", { id: siteId }, { enabled: false }],
        ["posts", "GET", { id: siteId }],
        ["posts", "POST", { id: siteId }, { title: "Planted" }],
        ["entry", "GET", { id: siteId, entryId: postB }],
        ["publish", "POST", { id: siteId, entryId: postB }, { rev: 1 }],
        ["unpublish", "POST", { id: siteId, entryId: postB }, { rev: 1 }],
        ["trash", "POST", { id: siteId, entryId: postB }, { rev: 1 }],
        ["restore", "POST", { id: siteId, entryId: postB }, { rev: 1 }],
        ["terms", "GET", { id: siteId }],
        ["terms", "POST", { id: siteId }, { taxonomy: "tag", name: "Planted" }],
        ["term", "PATCH", { id: siteId, termId: termB }, { name: "Renamed" }],
        ["term", "DELETE", { id: siteId, termId: termB }],
      ];
      for (const [name, method, params, body] of probes) {
        const out = await call(name, method, params, { body });
        expect([name, method, siteId, out.status, out.json]).toEqual([
          name,
          method,
          siteId,
          404,
          { kind: "missing" },
        ]);
      }
    }
    // Nothing of b's changed.
    expect((await row(postB)).deleted_at).toBeNull();
    expect((await row(postB)).published).toBeNull();
    const term = await admin.from("content_terms").select("name").eq("id", termB).single();
    expect(term.data?.name).toBe("Theirs");
    const planted = await admin
      .from("content_entries")
      .select("id")
      .eq("site_id", b.pageId)
      .eq("draft->>title", "Planted");
    expect(planted.data).toEqual([]);
    const b_type = await admin
      .from("content_types")
      .select("enabled")
      .eq("site_id", b.pageId)
      .eq("key", "post")
      .single();
    expect(b_type.data?.enabled).toBe(true);
  });

  it("another account's entry under my own site id is not-found, and so is a page entry", async () => {
    const actions: RouteName[] = ["publish", "unpublish", "trash", "restore"];
    for (const entryId of [postB, pageEntryA, "nope", "00000000-0000-4000-8000-000000000000"]) {
      const got = await call("entry", "GET", { id: a.pageId, entryId });
      expect([entryId, got.status, got.json]).toEqual([entryId, 404, { kind: "missing" }]);
      for (const name of actions) {
        const out = await call(name, "POST", { id: a.pageId, entryId }, { body: { rev: 1 } });
        expect([name, entryId, out.status, out.json]).toEqual([
          name,
          entryId,
          404,
          { kind: "missing" },
        ]);
      }
    }
    expect((await row(pageEntryA)).deleted_at).toBeNull();
    expect((await row(pageEntryA)).published).toBeNull();
    expect((await row(postB)).deleted_at).toBeNull();
    expect(mocks.invalidateEntry).not.toHaveBeenCalled();
    // The entry read never carries another account's draft.
    expect(
      JSON.stringify(await call("entry", "GET", { id: a.pageId, entryId: postB })),
    ).not.toContain("Secret");
  });

  it("types: lists the site's types with the posts usage; the post type turns on and off", async () => {
    const off = await call("typePost", "POST", { id: a.pageId }, { body: { enabled: false } });
    expect(off).toMatchObject({ status: 200, json: { kind: "ok", type: { enabled: false } } });
    expect(mocks.invalidateType).toHaveBeenCalledTimes(1);
    const on = await call("typePost", "POST", { id: a.pageId }, { body: { enabled: true } });
    expect(on).toMatchObject({
      status: 200,
      cache: "no-store",
      json: { kind: "ok", type: { key: "post", enabled: true, archivePath: "blog" } },
    });
    const list = await call("types", "GET", { id: a.pageId });
    expect(list.status).toBe(200);
    expect(list.cache).toBe("no-store");
    expect(list.json.usage).toEqual({ posts: 1, limit: 25 });
    const keys = (list.json.types as Array<{ key: string }>).map((t) => t.key);
    expect(keys).toContain("post");
    expect(keys[0]).toBe("page");
  });

  it("types/post: a bad body is invalid; an archive path a page uses answers the path message", async () => {
    for (const body of [{}, { enabled: "yes" }, { archivePath: 7 }, { archivePath: "Bad Path" }]) {
      const out = await call("typePost", "POST", { id: a.pageId }, { body });
      expect([JSON.stringify(body), out.status, out.json.kind]).toEqual([
        JSON.stringify(body),
        422,
        "invalid",
      ]);
    }
    // `about` is the path of a page entry of this site.
    const taken = await call(
      "typePost",
      "POST",
      { id: a.pageId },
      { body: { archivePath: "about" } },
    );
    expect(taken.status).toBe(409);
    expect(taken.json.kind).toBe("path");
    expect(typeof taken.json.message).toBe("string");
    const moved = await call(
      "typePost",
      "POST",
      { id: a.pageId },
      { body: { archivePath: "news" } },
    );
    expect(moved).toMatchObject({
      status: 200,
      json: { kind: "ok", type: { archivePath: "news" } },
    });
    await call("typePost", "POST", { id: a.pageId }, { body: { archivePath: "blog" } });
  });

  it("types/post: a reserved word is refused as an archive path with the path message, and nothing moves", async () => {
    for (const word of ["api", "share", "media", "og", "r", "sitemap", "hl-anything"]) {
      const out = await call("typePost", "POST", { id: a.pageId }, { body: { archivePath: word } });
      expect([word, out.status, out.json.kind]).toEqual([word, 409, "path"]);
      expect(typeof out.json.message).toBe("string");
    }
    const stored = await admin
      .from("content_types")
      .select("archive_path")
      .eq("site_id", a.pageId)
      .eq("key", "post")
      .single();
    expect(stored.data?.archive_path).toBe("blog");
  });

  it("types/post: a refused turn on at an address leaves the stored archive path as it was", async () => {
    const pathOf = async () =>
      (
        await admin
          .from("content_types")
          .select("archive_path, enabled")
          .eq("site_id", a.pageId)
          .eq("key", "post")
          .single()
      ).data;
    await call("typePost", "POST", { id: a.pageId }, { body: { enabled: false } });
    try {
      expect(await pathOf()).toEqual({ archive_path: "blog", enabled: false });
      // `about` is the path of a page entry of this site: turning the blog on there is refused.
      const out = await call(
        "typePost",
        "POST",
        { id: a.pageId },
        { body: { enabled: true, archivePath: "about" } },
      );
      expect(out.status).toBe(409);
      expect(out.json.kind).toBe("path");
      expect(await pathOf()).toEqual({ archive_path: "blog", enabled: false });
    } finally {
      await call("typePost", "POST", { id: a.pageId }, { body: { enabled: true } });
    }
  });

  it("types/post: a suspended account is refused", async () => {
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    try {
      const out = await call("typePost", "POST", { id: a.pageId }, { body: { enabled: false } });
      expect(out.status).toBe(403);
      expect(out.json.kind).toBe("suspended");
    } finally {
      await admin.from("accounts").update({ suspended_at: null }).eq("id", a.userId);
    }
  });

  it("posts: lists only the caller's own posts, never the page entries", async () => {
    const out = await call("posts", "GET", { id: a.pageId });
    expect(out.status).toBe(200);
    const items = out.json.items as Array<{ id: string; title: string }>;
    expect(items.map((item) => item.id)).toEqual([postA]);
    expect(out.json.nextCursor).toBeNull();
    const bad = await call("posts", "GET", { id: a.pageId }, { query: "?status=nonsense" });
    expect(bad.status).toBe(422);
    const none = await call("posts", "GET", { id: a.pageId }, { query: "?status=trashed" });
    expect(none.json.items).toEqual([]);
    const found = await call("posts", "GET", { id: a.pageId }, { query: "?q=min&sort=updated_at" });
    expect((found.json.items as unknown[]).length).toBe(1);
  });

  it("posts: New post makes a draft; the 26th on Free is refused by the database (HL010)", async () => {
    const made = await call("posts", "POST", { id: a.pageId }, { body: { title: "Second" } });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ kind: "ok", rev: 1 });
    const madeId = made.json.id as string;
    expect((await row(madeId)).draft).toMatchObject({ title: "Second" });
    const bad = await call("posts", "POST", { id: a.pageId }, { body: { title: 7 } });
    expect(bad.status).toBe(422);

    // Fill the site to its 25 posts with the secret key, then ask through the route.
    const type = await typeId(a.pageId, "post");
    const count = async () =>
      (
        await admin
          .from("content_entries")
          .select("id", { count: "exact", head: true })
          .eq("site_id", a.pageId)
          .eq("type_id", type)
      ).count ?? 0;
    const fill = Array.from({ length: 25 - (await count()) }, (_, n) => ({
      site_id: a.pageId,
      type_id: type,
      draft: { title: `Fill ${n}`, slug: "", body: "" } as never,
    }));
    const filled = await admin.from("content_entries").insert(fill).select("id");
    if (filled.error) throw new Error(filled.error.message);
    try {
      expect(await count()).toBe(25);
      const refused = await call("posts", "POST", { id: a.pageId }, { body: { title: "26th" } });
      expect(refused.status).toBe(403);
      expect(refused.json).toEqual({ kind: "limit", message: postLimitMessage("free", 25) });
      expect(await count()).toBe(25);
      const usage = await call("types", "GET", { id: a.pageId });
      expect(usage.json.usage).toEqual({ posts: 25, limit: 25 });
    } finally {
      await admin
        .from("content_entries")
        .delete()
        .in("id", [...filled.data.map((r) => r.id), madeId]);
    }
  });

  it("publish, unpublish, trash and restore: a stale rev is a conflict and changes nothing", async () => {
    const before = await row(postA);
    for (const name of ["publish", "unpublish", "trash"] as const) {
      const out = await call(
        name,
        "POST",
        { id: a.pageId, entryId: postA },
        { body: { rev: before.rev + 5 } },
      );
      expect([name, out.status, out.json]).toEqual([
        name,
        409,
        { kind: "conflict", currentRev: before.rev },
      ]);
    }
    for (const rev of [undefined, "1", 0, 1.5]) {
      const out = await call(
        "publish",
        "POST",
        { id: a.pageId, entryId: postA },
        { body: { rev } },
      );
      expect([String(rev), out.status, out.json.kind]).toEqual([String(rev), 422, "invalid"]);
    }
    expect(await row(postA)).toEqual(before);
    expect(mocks.invalidateEntry).not.toHaveBeenCalled();
  });

  it("the whole life of a post: publish, unpublish, trash, restore, each expiring its tags", async () => {
    const params = { id: a.pageId, entryId: postA };
    const start = await row(postA);
    const published = await call("publish", "POST", params, { body: { rev: start.rev } });
    expect(published.status).toBe(200);
    expect(published.cache).toBe("no-store");
    expect(published.json).toMatchObject({ kind: "ok" });
    expect(typeof published.json.publishedAt).toBe("string");
    expect((await row(postA)).published).toMatchObject({ title: "Mine", slug: "mine" });
    expect(mocks.invalidateEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ siteId: a.pageId, typeKey: "post", entryId: postA }),
    );
    // Only this post went live.
    expect((await row(pageEntryA)).published).toBeNull();

    const read = await call("entry", "GET", params);
    expect(read.status).toBe(200);
    expect(read.json.entry).toMatchObject({
      id: postA,
      status: "published",
      hasUnpublishedChanges: false,
      draft: { title: "Mine" },
    });

    const down = await call("unpublish", "POST", params, { body: { rev: (await row(postA)).rev } });
    expect(down).toMatchObject({ status: 200, json: { kind: "ok" } });
    expect((await row(postA)).published).toBeNull();
    expect((await row(postA)).draft).toMatchObject({ title: "Mine" });

    const trashed = await call("trash", "POST", params, { body: { rev: (await row(postA)).rev } });
    expect(trashed).toMatchObject({ status: 200, json: { kind: "ok" } });
    expect((await row(postA)).deleted_at).not.toBeNull();
    const inTrash = await call("posts", "GET", { id: a.pageId }, { query: "?status=trashed" });
    expect((inTrash.json.items as Array<{ id: string }>).map((i) => i.id)).toEqual([postA]);
    // A trashed post cannot be published.
    const again = await call("publish", "POST", params, { body: { rev: (await row(postA)).rev } });
    expect(again.status).toBe(404);

    const back = await call("restore", "POST", params, { body: { rev: (await row(postA)).rev } });
    expect(back).toMatchObject({ status: 200, json: { kind: "ok" } });
    const after = await row(postA);
    expect(after.deleted_at).toBeNull();
    expect(after.published).toBeNull();
    expect(back.json.rev).toBe(after.rev);
    expect(mocks.invalidateEntry).toHaveBeenCalledTimes(4);
  });

  it("publish lists what is wrong by field; a taken slug and a reserved slug are field messages", async () => {
    const empty = await insertPost(a, { title: "", slug: "", body: "" });
    const first = await insertPost(a, { title: "First", slug: "same", body: "x" });
    const second = await insertPost(a, { title: "Second", slug: "same", body: "y" });
    const reserved = await insertPost(a, { title: "Reserved", slug: "page", body: "z" });
    try {
      const invalid = await call(
        "publish",
        "POST",
        { id: a.pageId, entryId: empty },
        { body: { rev: 1 } },
      );
      expect(invalid.status).toBe(422);
      expect(invalid.json.kind).toBe("invalid");
      const paths = (invalid.json.issues as Array<{ path: string }>).map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(["title", "slug"]));
      expect((await row(empty)).published).toBeNull();

      expect(
        (await call("publish", "POST", { id: a.pageId, entryId: first }, { body: { rev: 1 } }))
          .status,
      ).toBe(200);
      const taken = await call(
        "publish",
        "POST",
        { id: a.pageId, entryId: second },
        { body: { rev: 1 } },
      );
      expect(taken.status).toBe(409);
      expect(taken.json.kind).toBe("slug");
      expect(typeof taken.json.message).toBe("string");
      expect((await row(second)).published).toBeNull();

      const word = await call(
        "publish",
        "POST",
        { id: a.pageId, entryId: reserved },
        { body: { rev: 1 } },
      );
      expect((await row(reserved)).published).toBeNull();
      // The schema names the slug field; a database refusal would answer {kind: "slug"}.
      const named =
        word.json.kind === "slug" ||
        (word.json.issues as Array<{ path: string }> | undefined)?.some((i) => i.path === "slug");
      expect([word.status === 422 || word.status === 409, named]).toEqual([true, true]);
    } finally {
      await admin.from("content_entries").delete().in("id", [empty, first, second, reserved]);
    }
  });

  it("draft save: a write from elsewhere mid-session (as MCP makes) answers conflict and is kept", async () => {
    const { updateEntryWithClient } = await import("@/lib/content");
    const params = { id: a.pageId, entryId: postA };
    const held = (await row(postA)).rev;
    const elsewhere = await updateEntryWithClient(admin, {
      actor: { userId: a.userId, source: "mcp" },
      entryId: postA,
      expectedRev: held,
      draft: { title: "Mine", slug: "mine", body: "Written by an assistant." },
    });
    expect(elsewhere.ok).toBe(true);
    const stale = await call("draft", "POST", params, {
      body: { rev: held, draft: { title: "Mine", slug: "mine", body: "Typed in the editor." } },
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual({ kind: "conflict", currentRev: held + 1 });
    expect((await row(postA)).draft).toMatchObject({ body: "Written by an assistant." });
    // A body over 512 KiB is refused by the schema, and nothing is stored.
    const big = await call("draft", "POST", params, {
      body: {
        rev: held + 1,
        draft: { title: "Mine", slug: "mine", body: "x".repeat(512 * 1024 + 1) },
      },
    });
    expect(big.status).toBe(422);
    expect((await row(postA)).rev).toBe(held + 1);
  });

  it("draft save and publish refuse a body the bounded lexer refuses: 422 invalid with a body message, never a 500", async () => {
    const { BODY_SHAPE_MESSAGES } = await import("@/lib/blog/markdown");
    const post = await insertPost(a, { title: "Heavy", slug: "heavy", body: "Fine" });
    try {
      const params = { id: a.pageId, entryId: post };
      const cases: Array<[string, string]> = [
        ["*a ".repeat(32_000), BODY_SHAPE_MESSAGES.work],
        ["*a **b ".repeat(8000), BODY_SHAPE_MESSAGES.work],
        [`${"> ".repeat(4000)}a`, BODY_SHAPE_MESSAGES.depth],
        [`${"- > ".repeat(2000)}a`, BODY_SHAPE_MESSAGES.depth],
        [`${"1. ".repeat(4000)}a`, BODY_SHAPE_MESSAGES.depth],
      ];
      for (const [body, message] of cases) {
        const start = Date.now();
        const out = await call("draft", "POST", params, {
          body: { rev: 1, draft: { title: "Heavy", slug: "heavy", body } },
        });
        expect([out.status, out.json.kind]).toEqual([422, "invalid"]);
        expect(out.json.issues).toEqual([{ path: "body", message }]);
        expect(Date.now() - start).toBeLessThan(5_000);
      }
      expect((await row(post)).rev).toBe(1);
      // A body stored before the bound (written behind the writer) is refused at publish the same way.
      await admin
        .from("content_entries")
        .update({
          draft: { title: "Heavy", slug: "heavy", body: `${"> ".repeat(4000)}a` } as never,
        })
        .eq("id", post);
      const published = await call("publish", "POST", params, { body: { rev: 1 } });
      expect([published.status, published.json.kind]).toEqual([422, "invalid"]);
      expect(published.json.issues).toEqual([{ path: "body", message: BODY_SHAPE_MESSAGES.depth }]);
      expect((await row(post)).published).toBeNull();
    } finally {
      await admin.from("content_entries").delete().eq("id", post);
    }
  });

  it("unpublish and trash: a cache expiry that fails twice answers cacheStale, and expire retries it", async () => {
    const post = await insertPost(a, { title: "Stale", slug: "stale", body: "Hello" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const params = { id: a.pageId, entryId: post };
      const published = await call("publish", "POST", params, { body: { rev: 1 } });
      expect(published.json).toMatchObject({ kind: "ok" });
      expect(published.json).not.toHaveProperty("cacheStale");
      mocks.invalidateEntry.mockImplementation(() => {
        throw new Error("cache down");
      });
      const off = await call("unpublish", "POST", params, {
        body: { rev: published.json.rev },
      });
      expect(off).toMatchObject({ status: 200, json: { kind: "ok", cacheStale: true } });
      // The write stood.
      expect((await row(post)).published).toBeNull();
      const failing = await call("expire", "POST", params);
      expect(failing).toMatchObject({ status: 200, json: { kind: "ok", expired: false } });
      mocks.invalidateEntry.mockReset();
      const again = await call("expire", "POST", params);
      expect(again).toMatchObject({
        status: 200,
        cache: "no-store",
        json: { kind: "ok", expired: true },
      });
      expect(mocks.invalidateEntry).toHaveBeenCalledTimes(1);
      // Another account's post, or a page entry, is the one not-found.
      expect((await call("expire", "POST", { id: a.pageId, entryId: postB })).status).toBe(404);
      expect((await call("expire", "POST", { id: a.pageId, entryId: pageEntryA })).status).toBe(
        404,
      );
    } finally {
      mocks.invalidateEntry.mockReset();
      log.mockRestore();
      await admin.from("content_entries").delete().eq("id", post);
    }
  });

  it(
    "expire is rate limited per account: past the limit a minute it answers 429 and expires nothing",
    { timeout: 30_000 },
    async () => {
      const { EXPIRE_RATE_LIMIT, EXPIRE_RATE_LIMITED } = await import("@/lib/posts/routes-core");
      const owner = await makeOwner(admin as never, "pr-limit");
      owners.push(owner);
      const on = await admin
        .from("content_types")
        .update({ enabled: true })
        .eq("site_id", owner.pageId)
        .eq("key", "post");
      if (on.error) throw new Error(on.error.message);
      as(owner);
      const post = await insertPost(owner, { title: "Many", slug: "many", body: "Hello" });
      mocks.invalidateEntry.mockReset();
      const params = { id: owner.pageId, entryId: post };
      const answers = await Promise.all(
        Array.from({ length: EXPIRE_RATE_LIMIT + 20 }, () => call("expire", "POST", params)),
      );
      const statuses = answers.map((answer) => answer.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(EXPIRE_RATE_LIMIT);
      expect(statuses.filter((status) => status === 429)).toHaveLength(20);
      expect(answers.find((answer) => answer.status === 429)).toMatchObject({
        cache: "no-store",
        json: { kind: "limit", message: EXPIRE_RATE_LIMITED },
      });
      // Only the allowed ones expired anything.
      expect(mocks.invalidateEntry).toHaveBeenCalledTimes(EXPIRE_RATE_LIMIT);
      // Another account's bucket is its own.
      as(a);
      expect((await call("expire", "POST", { id: a.pageId, entryId: postA })).status).toBe(200);
    },
  );

  it("revisions: a post of an enabled blog lists and restores; another account's does not", async () => {
    const recorded = await admin.rpc("record_entry_revision", {
      p_entry_id: postA,
      p_source: "editor",
    });
    if (recorded.error) throw new Error(recorded.error.message);
    const list = await call("revisions", "GET", { id: a.pageId, entryId: postA });
    expect(list.status).toBe(200);
    expect((list.json.revisions as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(list.json)).not.toContain("Hello");
    const foreign = await call("revisions", "GET", { id: a.pageId, entryId: postB });
    expect(foreign).toMatchObject({ status: 404, json: { kind: "missing" } });
    as(b);
    const theirs = await call("revisions", "GET", { id: a.pageId, entryId: postA });
    expect(theirs).toMatchObject({ status: 404, json: { kind: "missing" } });
  });

  it("terms: create, list, rename, delete; a term of another site is not-found", async () => {
    const made = await call(
      "terms",
      "POST",
      { id: a.pageId },
      { body: { taxonomy: "category", name: "Field notes" } },
    );
    expect(made.status).toBe(201);
    expect(made.cache).toBe("no-store");
    const term = made.json.term as { id: string; slug: string; name: string };
    expect(term).toMatchObject({ name: "Field notes", slug: "field-notes", taxonomy: "category" });

    const child = await call(
      "terms",
      "POST",
      { id: a.pageId },
      { body: { taxonomy: "category", name: "Deep", parentId: term.id } },
    );
    expect(child.status).toBe(201);
    const childId = (child.json.term as { id: string; parentId: string }).id;
    expect((child.json.term as { parentId: string }).parentId).toBe(term.id);
    const tooDeep = await call(
      "terms",
      "POST",
      { id: a.pageId },
      { body: { taxonomy: "category", name: "Deeper", parentId: childId } },
    );
    expect(tooDeep.status).toBe(422);
    // A parent of another site is refused, and nothing is linked to it.
    const foreignParent = await call(
      "terms",
      "POST",
      { id: a.pageId },
      { body: { taxonomy: "category", name: "Stray", parentId: termB } },
    );
    expect(foreignParent.status).toBe(422);

    const same = await call(
      "terms",
      "POST",
      { id: a.pageId },
      { body: { taxonomy: "category", name: "Field notes" } },
    );
    expect(same.status).toBe(409);
    expect(same.json.kind).toBe("slug");

    for (const body of [{}, { taxonomy: "author", name: "X" }, { taxonomy: "tag", name: "" }]) {
      const out = await call("terms", "POST", { id: a.pageId }, { body });
      expect([JSON.stringify(body), out.status]).toEqual([JSON.stringify(body), 422]);
    }

    const list = await call("terms", "GET", { id: a.pageId });
    expect(list.status).toBe(200);
    const ids = (list.json.terms as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([term.id, childId]));
    expect(ids).not.toContain(termB);

    const renamed = await call(
      "term",
      "PATCH",
      { id: a.pageId, termId: term.id },
      { body: { name: "Notes" } },
    );
    expect(renamed).toMatchObject({ status: 200, json: { kind: "ok", term: { name: "Notes" } } });

    // b's term through a's site id, and a's term through b's session.
    for (const [method, body] of [
      ["PATCH", { name: "Taken over" }],
      ["DELETE", undefined],
    ] as const) {
      const out = await call("term", method, { id: a.pageId, termId: termB }, { body });
      expect([method, out.status, out.json]).toEqual([method, 404, { kind: "missing" }]);
    }
    as(b);
    const stolen = await call("term", "DELETE", { id: a.pageId, termId: term.id });
    expect(stolen).toMatchObject({ status: 404, json: { kind: "missing" } });
    as(a);
    expect(
      (await admin.from("content_terms").select("name").eq("id", termB).single()).data,
    ).toEqual({ name: "Theirs" });

    const gone = await call("term", "DELETE", { id: a.pageId, termId: term.id });
    expect(gone).toMatchObject({ status: 200, json: { kind: "ok", id: term.id } });
    const left = await admin.from("content_terms").select("id, parent_id").eq("id", childId);
    expect(left.data).toEqual([{ id: childId, parent_id: null }]);
    await call("term", "DELETE", { id: a.pageId, termId: childId });
  });

  it("terms: the 501st term of a blog answers the limit message (HL015)", async () => {
    const type = await typeId(a.pageId, "post");
    const have =
      (
        await admin
          .from("content_terms")
          .select("id", { count: "exact", head: true })
          .eq("type_id", type)
      ).count ?? 0;
    const fill = Array.from({ length: 500 - have }, (_, n) => ({
      site_id: a.pageId,
      type_id: type,
      taxonomy: "tag",
      name: `Tag ${n}`,
      slug: `tag-fill-${n}`,
    }));
    // In batches: one insert of 500 rows fires the cap's trigger 500 times in a single request.
    const filled = { data: [] as Array<{ id: string }> };
    for (let at = 0; at < fill.length; at += 100) {
      const batch = await admin
        .from("content_terms")
        .insert(fill.slice(at, at + 100))
        .select("id");
      if (batch.error) throw new Error(batch.error.message);
      filled.data.push(...batch.data);
    }
    try {
      const out = await call(
        "terms",
        "POST",
        { id: a.pageId },
        { body: { taxonomy: "tag", name: "One too many" } },
      );
      expect(out.status).toBe(403);
      expect(out.json).toEqual({ kind: "limit", message: TERM_LIMIT_MESSAGE });
    } finally {
      await admin
        .from("content_terms")
        .delete()
        .in(
          "id",
          filled.data.map((r) => r.id),
        );
    }
  }, 60_000);
});
