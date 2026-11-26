// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  restore: vi.fn(),
  updateTag: vi.fn(),
  admin: undefined as unknown,
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag, revalidateTag: mocks.updateTag }));
// The real writer, watched: the restore must reach it with the editor as its source.
vi.mock("@/lib/content/revisions-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/revisions-core")>();
  mocks.restore.mockImplementation(actual.restoreRevisionWithClient);
  return { ...actual, restoreRevisionWithClient: mocks.restore };
});

/**
 * M15-10: the two page revisions routes. GET lists a page's revisions without snapshots; POST
 * restores one into the page's DRAFT at the rev the editor holds. Both: session, origin, no-store,
 * and one `missing` answer for anything that is not a page of the caller's site.
 */
const { run } = await stackIsUp();
const BASE = "http://app.localhost:3000/api/pages";
const ORIGIN = "http://app.localhost:3000";

describe.skipIf(!run)("the page revisions routes", () => {
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
  let entryId: string;
  let foreignEntry: string;
  let postId: string | null = null;
  const page = (title: string) => ({ path: "about", title, description: "", blocks: [] });

  async function typeId(siteId: string, key: string) {
    return (
      await admin
        .from("content_types")
        .select("id")
        .eq("site_id", siteId)
        .eq("key", key)
        .maybeSingle()
    ).data?.id;
  }
  async function makeEntry(owner: TestOwner, draft: object) {
    const made = await admin
      .from("content_entries")
      .insert({
        site_id: owner.pageId,
        type_id: (await typeId(owner.pageId, "page"))!,
        draft: draft as never,
      })
      .select("id")
      .single();
    if (made.error) throw new Error(made.error.message);
    return made.data.id;
  }
  const row = async (id: string = entryId) => {
    const found = await admin
      .from("content_entries")
      .select("rev, draft, published")
      .eq("id", id)
      .single();
    return {
      rev: Number(found.data!.rev),
      draft: found.data!.draft as { title: string },
      published: found.data!.published,
    };
  };

  beforeAll(async () => {
    mocks.admin = admin;
    a = await makeOwner(admin as never, "rv-a");
    b = await makeOwner(admin as never, "rv-b");
    owners.push(a, b);
    entryId = await makeEntry(a, page("First"));
    foreignEntry = await makeEntry(b, page("Theirs"));
    // Three revisions: First, Second, Third. The writer keeps at most one revision per ten minutes,
    // so each is recorded here, right after its save.
    const record = async () => {
      const done = await admin.rpc("record_entry_revision", {
        p_entry_id: entryId,
        p_source: "editor",
      });
      if (done.error) throw new Error(done.error.message);
    };
    await record();
    const { updateEntryWithClient } = await import("@/lib/content/entries-core");
    for (const title of ["Second", "Third"]) {
      const out = await updateEntryWithClient(admin, {
        actor: { userId: a.userId, source: "editor" },
        entryId,
        expectedRev: (await row()).rev,
        draft: page(title),
      });
      if (!out.ok) throw new Error(out.error);
      await record();
    }
  });
  afterAll(async () => removeOwners(admin as never, owners));
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
    mocks.getSessionUser.mockResolvedValue({ id: a.userId });
    mocks.restore.mockClear();
    mocks.updateTag.mockClear();
  });

  async function list(opts: { siteId?: string; entry?: string; origin?: string } = {}) {
    const { GET } =
      await import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/revisions/route");
    const siteId = opts.siteId ?? a.pageId;
    const entry = opts.entry ?? entryId;
    const response = await GET(
      new Request(`${BASE}/${siteId}/entries/${entry}/revisions`, {
        headers: opts.origin ? { origin: opts.origin } : {},
      }) as never,
      { params: Promise.resolve({ id: siteId, entryId: entry }) },
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      json: (await response.json()) as Record<string, unknown>,
    };
  }
  async function restore(
    opts: {
      siteId?: string;
      entry?: string;
      rev?: string;
      body?: unknown;
      origin?: string;
      contentType?: string;
    } = {},
  ) {
    const { POST } =
      await import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/revisions/[rev]/restore/route");
    const siteId = opts.siteId ?? a.pageId;
    const entry = opts.entry ?? entryId;
    const rev = opts.rev ?? "1";
    const response = await POST(
      new Request(`${BASE}/${siteId}/entries/${entry}/revisions/${rev}/restore`, {
        method: "POST",
        headers: {
          "content-type": opts.contentType ?? "application/json",
          ...(opts.origin ? { origin: opts.origin } : {}),
        },
        body: JSON.stringify(opts.body ?? { rev: (await row()).rev }),
      }) as never,
      { params: Promise.resolve({ id: siteId, entryId: entry, rev }) },
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      json: (await response.json()) as Record<string, unknown>,
    };
  }

  it("401 without a session, on both routes, before anything is read", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect(await list()).toEqual({
      status: 401,
      cache: "no-store",
      json: { kind: "unauthorized" },
    });
    expect(await restore({ body: { rev: 1 } })).toEqual({
      status: 401,
      cache: "no-store",
      json: { kind: "unauthorized" },
    });
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("a foreign origin is refused with 403 on both routes; the app's own origin passes", async () => {
    expect(await list({ origin: "https://evil.example" })).toMatchObject({
      status: 403,
      json: { error: "forbidden_origin" },
    });
    const before = await row();
    expect(await restore({ origin: "https://evil.example" })).toMatchObject({
      status: 403,
      json: { error: "forbidden_origin" },
    });
    expect(await row()).toEqual(before);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect((await list({ origin: ORIGIN })).status).toBe(200);
  });

  it("the restore takes JSON only", async () => {
    expect(await restore({ contentType: "text/plain" })).toMatchObject({ status: 415 });
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("lists the revisions newest first, with no snapshot", async () => {
    const out = await list();
    expect(out.status).toBe(200);
    expect(out.cache).toBe("no-store");
    expect(out.json.kind).toBe("ok");
    const revisions = out.json.revisions as Record<string, unknown>[];
    expect(revisions.length).toBeGreaterThanOrEqual(3);
    const revs = revisions.map((r) => r.rev as number);
    expect(revs).toEqual([...revs].sort((x, y) => y - x));
    for (const revision of revisions) {
      expect(Object.keys(revision).sort()).toEqual(["createdAt", "rev", "source", "wasPublished"]);
    }
    // No draft content travels with the list.
    expect(JSON.stringify(out.json)).not.toMatch(/snapshot|Second|Third|blocks/);
  });

  it("another account's entry, an entry of another site and odd ids all answer 404 missing", async () => {
    const missing = { status: 404, cache: "no-store", json: { kind: "missing" } };
    // My session, their entry under my site id.
    expect(await list({ entry: foreignEntry })).toEqual(missing);
    expect(await restore({ entry: foreignEntry, body: { rev: 1 } })).toEqual(missing);
    // My session, their site and their entry.
    expect(await list({ siteId: b.pageId, entry: foreignEntry })).toEqual(missing);
    expect(await restore({ siteId: b.pageId, entry: foreignEntry, body: { rev: 1 } })).toEqual(
      missing,
    );
    // My entry under their site id.
    expect(await list({ siteId: b.pageId })).toEqual(missing);
    expect(await restore({ siteId: b.pageId })).toEqual(missing);
    // Malformed ids, an unknown revision, a revision number that is not one.
    expect(await list({ entry: "nope" })).toEqual(missing);
    expect(await restore({ rev: "9999" })).toEqual(missing);
    expect(await restore({ rev: "1;drop" })).toEqual(missing);
    expect(await restore({ rev: "0" })).toEqual(missing);
    expect((await row(foreignEntry)).draft.title).toBe("Theirs");
  });

  it("a post entry is not a page: 404 missing", async () => {
    const postType = await typeId(a.pageId, "post");
    if (!postType) return; // the site has no post type: nothing to probe
    const made = await admin
      .from("content_entries")
      .insert({
        site_id: a.pageId,
        type_id: postType,
        draft: { title: "A post", slug: "a-post", body: [] } as never,
      })
      .select("id")
      .single();
    if (made.error) return; // the type is off or its draft shape differs: covered by pgTAP
    postId = made.data.id;
    expect((await list({ entry: postId })).status).toBe(404);
    expect((await restore({ entry: postId, body: { rev: 1 } })).status).toBe(404);
  });

  it("a trashed page answers 404 missing", async () => {
    const trashed = await makeEntry(a, { ...page("Gone"), path: "gone" });
    await admin
      .from("content_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", trashed);
    expect((await list({ entry: trashed })).json).toEqual({ kind: "missing" });
    expect((await restore({ entry: trashed, body: { rev: 1 } })).json).toEqual({
      kind: "missing",
    });
  });

  it("a restore with a stale rev answers 409 conflict with currentRev and changes nothing", async () => {
    const before = await row();
    const out = await restore({ body: { rev: before.rev + 3 } });
    expect(out).toEqual({
      status: 409,
      cache: "no-store",
      json: { kind: "conflict", currentRev: before.rev },
    });
    expect(await row()).toEqual(before);
  });

  it("a restore without a rev is 422 invalid", async () => {
    expect(await restore({ body: {} })).toMatchObject({ status: 422, json: { kind: "invalid" } });
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("restores a revision into the draft through the writer, as the editor; nothing is published and no tag expires", async () => {
    const before = await row();
    expect(before.draft.title).toBe("Third");
    const first = ((await list()).json.revisions as { rev: number }[]).at(-1)!.rev;
    const out = await restore({ rev: String(first) });
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ kind: "ok", rev: before.rev + 1, unchanged: false });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.restore.mock.calls[0]![1]).toEqual({
      actor: { userId: a.userId, source: "editor" },
      entryId,
      rev: first,
      expectedRev: before.rev,
    });
    const after = await row();
    expect(after.draft.title).toBe("First");
    expect(after.rev).toBe(before.rev + 1);
    expect(after.published).toBeNull();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});
