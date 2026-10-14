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
  update: vi.fn(),
  admin: undefined as unknown,
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
    opts: { siteId?: string; entry?: string; body?: unknown; origin?: string } = {},
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
        },
        body: JSON.stringify(opts.body ?? { rev: await rev(), draft: page("Saved") }),
      },
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
