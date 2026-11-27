// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { LOCAL_DB_CONTAINER } from "../../scripts/lib/local-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  update: vi.fn(),
  admin: undefined as unknown,
}));
vi.mock("@/lib/media/cleanup-client", () => ({ scheduleMediaCleanup: () => {} }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => {
    throw new Error("the entry saves never use the browser client");
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
// Real writer by default; individual tests substitute its answer to drive each error mapping.
vi.mock("@/lib/content/entries-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/entries-core")>();
  mocks.update.mockImplementation(actual.updateEntryWithClient);
  return { ...actual, updateEntryWithClient: mocks.update };
});

const { run } = await stackIsUp();

function psql(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      LOCAL_DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-q",
    ],
    { input: sql, encoding: "utf8" },
  ).trim();
}

describe.skipIf(!run)("POST /api/pages/{id}/entries/{entryId}/draft", () => {
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
  const page = (title: string) => ({ path: "/about", title, description: "", blocks: [] });

  beforeAll(async () => {
    mocks.admin = admin;
    a = await makeOwner(admin as never, "es-a");
    b = await makeOwner(admin as never, "es-b");
    owners.push(a, b);
    const made = await admin
      .from("content_entries")
      .insert({
        site_id: a.pageId,
        type_id: (
          await admin
            .from("content_types")
            .select("id")
            .eq("site_id", a.pageId)
            .eq("key", "page")
            .single()
        ).data!.id,
        draft: page("About"),
      })
      .select("id, rev")
      .single();
    if (made.error) throw new Error(made.error.message);
    entryId = made.data.id;
  });
  afterAll(async () => removeOwners(admin as never, owners));
  beforeEach(() => {
    mocks.getSessionUser.mockResolvedValue({ id: a.userId });
  });

  const rev = async () =>
    Number(
      (await admin.from("content_entries").select("rev").eq("id", entryId).single()).data!.rev,
    );

  async function post(
    opts: {
      siteId?: string;
      entry?: string;
      body?: unknown;
      origin?: string;
      raw?: BodyInit;
      headers?: Record<string, string>;
      duplex?: boolean;
    } = {},
  ) {
    const { POST } =
      await import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/draft/route");
    const siteId = opts.siteId ?? a.pageId;
    const entry = opts.entry ?? entryId;
    const request = new Request(
      `http://app.localhost:3000/api/pages/${siteId}/entries/${entry}/draft`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.origin ? { origin: opts.origin } : {}),
          ...opts.headers,
        },
        body: opts.raw ?? JSON.stringify(opts.body ?? { rev: await rev(), draft: page("Saved") }),
        ...(opts.duplex ? { duplex: "half" } : {}),
      } as RequestInit,
    );
    const response = await POST(request as never, {
      params: Promise.resolve({ id: siteId, entryId: entry }),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  it("saves at the current rev and bumps it", async () => {
    const before = await rev();
    const out = await post({ body: { rev: before, draft: page("One") } });
    expect(out).toEqual({ status: 200, json: { kind: "ok", rev: before + 1, unchanged: false } });
    expect(await rev()).toBe(before + 1);
  });

  it("a stale rev gets conflict and changes nothing", async () => {
    const current = await rev();
    const out = await post({ body: { rev: current - 1, draft: page("Stale") } });
    expect(out.status).toBe(409);
    expect(out.json).toEqual({ kind: "conflict", currentRev: current });
    const row = await admin.from("content_entries").select("rev, draft").eq("id", entryId).single();
    expect(Number(row.data!.rev)).toBe(current);
    expect((row.data!.draft as { title: string }).title).not.toBe("Stale");
  });

  it("another user's entry, or a site that does not hold the entry, gets not-found", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: b.userId });
    const before = await rev();
    expect(await post()).toMatchObject({ status: 404, json: { kind: "missing" } });
    expect(await post({ siteId: b.pageId })).toMatchObject({
      status: 404,
      json: { kind: "missing" },
    });
    mocks.getSessionUser.mockResolvedValue({ id: a.userId });
    expect(await post({ siteId: b.pageId })).toMatchObject({ status: 404 });
    expect(await rev()).toBe(before);
  });

  it("refuses a missing rev, a foreign origin and a signed-out request", async () => {
    expect(await post({ body: { draft: page("x") } })).toMatchObject({
      status: 422,
      json: { kind: "invalid" },
    });
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });

  it("a malformed site id or entry id is not-found before any query, like an unknown one", async () => {
    const before = await rev();
    const writes = mocks.update.mock.calls.length;
    const from = vi.spyOn(admin, "from");
    try {
      for (const bad of ["not-a-uuid", "123", `${entryId}x`, "' or 1=1 --", "%00"]) {
        const badEntry = await post({ entry: bad });
        expect(badEntry.status, bad).toBe(404);
        expect(badEntry.json, bad).toEqual({ kind: "missing" });
        const badSite = await post({ siteId: bad });
        expect(badSite.status, bad).toBe(404);
        expect(badSite.json, bad).toEqual({ kind: "missing" });
      }
      // `rev()` reads content_entries for the default body; the route itself asked for nothing else.
      expect(from.mock.calls.every(([table]) => table === "content_entries")).toBe(true);
      expect(mocks.update.mock.calls.length).toBe(writes);
    } finally {
      from.mockRestore();
    }
    expect(await rev()).toBe(before);
  });

  it("a body over the cap is refused by its declared length before it is read or parsed", async () => {
    const { MAX_ENTRY_SAVE_BODY_BYTES } = await import("@/lib/site-pages/entry-save-core");
    const { MAX_DRAFT_BYTES } = await import("@/lib/content/schemas");
    expect(MAX_ENTRY_SAVE_BODY_BYTES).toBeGreaterThan(MAX_DRAFT_BYTES);
    expect(MAX_ENTRY_SAVE_BODY_BYTES).toBeLessThanOrEqual(MAX_DRAFT_BYTES * 2);
    const before = await rev();
    const writes = mocks.update.mock.calls.length;
    // The declared length alone decides: the stream behind it is never pulled.
    let pulled = 0;
    const unread = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const declared = await post({
      raw: unread,
      duplex: true,
      headers: { "content-length": String(MAX_ENTRY_SAVE_BODY_BYTES + 1) },
    });
    expect(declared.status).toBe(413);
    expect(declared.json).toEqual({ kind: "too-large" });
    expect(pulled).toBeLessThanOrEqual(1);
    // No declared length: counted as it arrives and dropped at the cap.
    let sent = 0;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const streamed = await post({ raw: endless, duplex: true });
    expect(streamed.status).toBe(413);
    expect(sent).toBeLessThanOrEqual(MAX_ENTRY_SAVE_BODY_BYTES + 4 * chunk.byteLength);
    expect(mocks.update.mock.calls.length).toBe(writes);
    expect(await rev()).toBe(before);
    // A body that is not JSON is still a 400, and a normal save still goes through.
    expect((await post({ raw: "{nope" })).status).toBe(400);
    expect((await post()).status).toBe(200);
  });

  /**
   * M15-07 step 2, end to end: the real database error, through the writer and the route, into the
   * editor's own save function and the notice its result shows. The browser's fetch to the route is
   * handed to the route handler; everything else (the Supabase client) keeps the real fetch.
   */
  async function throughTheEditor(run: () => Promise<void>) {
    const { POST } =
      await import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/draft/route");
    const realFetch = globalThis.fetch;
    const answers: Array<{ status: number; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const match = /^\/api\/pages\/([^/]+)\/entries\/([^/]+)\/draft$/.exec(url);
      if (!match) return realFetch(input, init);
      const response = await POST(new Request(`http://app.localhost:3000${url}`, init) as never, {
        params: Promise.resolve({ id: match[1]!, entryId: match[2]! }),
      });
      answers.push({ status: response.status, body: await response.clone().json() });
      return response;
    });
    try {
      await run();
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }
    return answers;
  }

  it("HL009 from the database reaches the storage-full notice, for a sub-page and for Home's blocks", async () => {
    const { createSubPageRevisions, createSubPageSaveFn } =
      await import("@/lib/site-pages/save-client");
    const { createDraftSaver } = await import("@/lib/editor/save-client");
    const { saveIndicatorText } = await import("@/components/workspace/toolbar/save-status");
    const { STORAGE_FULL_MESSAGE } = await import("@/lib/editor/messages");
    const { PLAN_LIMITS } = await import("@/lib/limits");
    const { emptyDraft } = await import("@/lib/document");

    // account_site_bytes is written by triggers only (no API role may touch it), so psql sets it.
    const usage = Number(
      psql(`select bytes from public.account_site_bytes where owner_id = '${a.userId}'`),
    );
    expect(Number.isFinite(usage)).toBe(true);
    // Home's entry, as the move makes it.
    const home = await admin
      .from("content_entries")
      .insert({
        site_id: a.pageId,
        type_id: (
          await admin
            .from("content_types")
            .select("id")
            .eq("site_id", a.pageId)
            .eq("key", "page")
            .single()
        ).data!.id,
        draft: { path: "/", title: "", description: "", blocks: [] },
      })
      .select("id, rev")
      .single();
    if (home.error) throw new Error(home.error.message);

    // The account sits a few bytes under its plan's cap, so any growth is over it.
    psql(
      `update public.account_site_bytes set bytes = ${PLAN_LIMITS.free.contentBytes - 8} where owner_id = '${a.userId}'`,
    );
    try {
      // The database itself raises HL009 for this growth.
      const direct = await admin
        .from("content_entries")
        .update({ draft: page("x".repeat(200)) })
        .eq("id", entryId);
      expect(direct.error?.code).toBe("HL009");

      const before = await rev();
      const revisions = createSubPageRevisions({ [entryId]: before });
      let sub: unknown;
      let homeResult: unknown;
      const answers = await throughTheEditor(async () => {
        sub = await createSubPageSaveFn(revisions, a.pageId)(entryId, {
          ...page("About"),
          description: "y".repeat(150),
        } as never);
        const save = createDraftSaver(a.pageId, {
          entryId: home.data.id,
          rev: Number(home.data.rev),
        });
        const text = "z".repeat(200);
        homeResult = await save(
          {
            ...emptyDraft("es-a"),
            blocks: [{ id: "txt-aaaaaaaa", type: "text", visible: true, text } as never],
          },
          "1",
        );
      });
      expect(answers).toEqual([
        { status: 403, body: { kind: "storage-full" } },
        { status: 403, body: { kind: "storage-full" } },
      ]);
      expect(sub).toEqual({ kind: "storage-full" });
      expect(homeResult).toEqual({ kind: "storage-full" });
      // The notice of that result is the existing storage message.
      expect(saveIndicatorText("storage-full")).toBe(STORAGE_FULL_MESSAGE);
      expect(await rev()).toBe(before);
      expect(revisions.get(entryId)).toBe(before);
    } finally {
      // Home's entry goes, then the total is what it was before this test.
      await admin.from("content_entries").delete().eq("id", home.data.id);
      psql(`update public.account_site_bytes set bytes = ${usage} where owner_id = '${a.userId}'`);
    }
  });

  it("HL012 from the database reaches the path notice: a path another page holds, and a reserved one", async () => {
    const { createSubPageRevisions, createSubPageSaveFn } =
      await import("@/lib/site-pages/save-client");
    const { CONTENT_MESSAGES } = await import("@/lib/content/errors");
    const typeId = (
      await admin
        .from("content_types")
        .select("id")
        .eq("site_id", a.pageId)
        .eq("key", "page")
        .single()
    ).data!.id;
    const other = await admin
      .from("content_entries")
      .insert({
        site_id: a.pageId,
        type_id: typeId,
        draft: { ...page("Taken"), path: "/taken" },
      })
      .select("id")
      .single();
    if (other.error) throw new Error(other.error.message);
    try {
      // The database itself raises HL012 for the taken path.
      const direct = await admin
        .from("content_entries")
        .update({ draft: { ...page("About"), path: "/taken" } })
        .eq("id", entryId);
      expect(direct.error?.code).toBe("HL012");

      const before = await rev();
      const revisions = createSubPageRevisions({ [entryId]: before });
      let result: unknown;
      const answers = await throughTheEditor(async () => {
        result = await createSubPageSaveFn(revisions, a.pageId)(entryId, {
          ...page("About"),
          path: "/taken",
        } as never);
      });
      expect(answers).toEqual([
        { status: 409, body: { kind: "path", message: CONTENT_MESSAGES.path_taken } },
      ]);
      // The editor flags the page as one that cannot be saved until the field is fixed.
      expect(result).toEqual({ kind: "invalid" });
      expect(await rev()).toBe(before);
      const stored = await admin.from("content_entries").select("draft").eq("id", entryId).single();
      expect((stored.data!.draft as { path: string }).path).toBe("/about");
    } finally {
      await admin.from("content_entries").delete().eq("id", other.data.id);
    }
  });

  it("a suspended owner is refused and nothing changes", async () => {
    const before = await rev();
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    const out = await post({ body: { rev: before, draft: page("Nope") } });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", a.userId);
    expect(out.status).toBe(403);
    expect(out.json).toMatchObject({ kind: "suspended", code: "account_suspended" });
    expect(await rev()).toBe(before);
  });

  it("a draft the schema refuses is invalid", async () => {
    const out = await post({ body: { rev: await rev(), draft: { nonsense: true } } });
    expect(out.status).toBe(422);
    expect(out.json.kind).toBe("invalid");
  });

  it.each([
    [
      "blocked_link",
      422,
      { kind: "blocked", hosts: ["bad.example"], blockIds: ["b1"] },
      { hosts: ["bad.example"], blockIds: ["b1"] },
    ],
    ["storage_full", 403, { kind: "storage-full" }, {}],
    ["path_taken", 409, { kind: "path" }, {}],
    ["too_large", 413, { kind: "too-large" }, {}],
    ["error", 500, { kind: "error" }, {}],
  ] as const)("the writer's %s maps to %j", async (error, status, expected, extra) => {
    mocks.update.mockResolvedValueOnce({ ok: false, status, error, message: "m", ...extra });
    const out = await post();
    expect(out.status).toBe(status);
    expect(out.json).toMatchObject(expected);
  });
});
