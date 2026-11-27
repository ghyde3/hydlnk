// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

/**
 * M20-07, M20-09, M20-10: the schedule routes on the app host, against the local stack, with the
 * session stubbed. `/api/pages/{id}/entries/{entryId}/schedule` (GET, POST, DELETE) and
 * `/api/pages/{id}/schedules` (GET).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
}));
const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  admin: null as unknown,
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));

const { run } = await stackIsUp();

const ORIGIN = "http://app.localhost:3000";
const ahead = (minutes: number) =>
  new Date(Math.ceil((Date.now() + minutes * 60_000) / 60_000) * 60_000)
    .toISOString()
    .slice(0, 16) + ":00Z";

describe.skipIf(!run)("M20 the schedule routes", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        {
          auth: { persistSession: false },
        },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];
  // Imported in beforeAll: the routes read the server env at import, which the unit step has not.
  let route: typeof import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/schedule/route");
  let siteRoute: typeof import("@/app/(editor)/app/api/pages/[id]/schedules/route");
  let a: TestOwner;
  let b: TestOwner;
  let free: TestOwner;
  let aPost: { id: string; rev: number };
  let aHome: { id: string; rev: number };
  let bPage: { id: string; rev: number };

  const insert = async (o: TestOwner, key: "post" | "page", draft: Record<string, unknown>) => {
    const type = (
      await admin.from("content_types").select("id").eq("site_id", o.pageId).eq("key", key).single()
    ).data!;
    const made = await admin
      .from("content_entries")
      .insert({ site_id: o.pageId, type_id: type.id, draft: draft as never })
      .select("id, rev")
      .single();
    if (made.error) throw new Error(made.error.message);
    return { id: made.data.id as string, rev: Number(made.data.rev) };
  };
  const call = (
    method: "GET" | "POST" | "DELETE",
    o: TestOwner,
    site: string,
    entry: string,
    body?: unknown,
    headers: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" },
  ) => {
    mocks.user = { id: o.userId, email: o.email };
    const request = new NextRequest(`${ORIGIN}/api/pages/${site}/entries/${entry}/schedule`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const params = { params: Promise.resolve({ id: site, entryId: entry }) };
    return method === "GET"
      ? route.GET(request, params)
      : method === "POST"
        ? route.POST(request, params)
        : route.DELETE(request, params);
  };
  const json = async (response: Response) => ({
    status: response.status,
    body: await response.json(),
  });

  beforeAll(async () => {
    route = await import("@/app/(editor)/app/api/pages/[id]/entries/[entryId]/schedule/route");
    siteRoute = await import("@/app/(editor)/app/api/pages/[id]/schedules/route");
    mocks.admin = admin;
    a = await makeOwner(admin as never, "m20r-a", undefined, "pro");
    b = await makeOwner(admin as never, "m20r-b", undefined, "pro");
    free = await makeOwner(admin as never, "m20r-free");
    owners.push(a, b, free);
    for (const o of owners) await enablePost(admin, o.pageId);
    aPost = await insert(a, "post", { title: "Hello", slug: "hello" });
    const homeId = await moveHome(admin as never, a.pageId);
    aHome = { id: homeId, rev: 1 };
    bPage = await insert(b, "page", { path: "other", title: "Other", description: "", blocks: [] });
  });
  beforeEach(() => {
    mocks.user = null;
  });
  afterAll(async () => removeOwners(admin as never, owners));

  it("M20-07 schedules a post, reads it back, and cancels it", async () => {
    const runAt = ahead(10);
    const made = await json(
      await call("POST", a, a.pageId, aPost.id, { rev: aPost.rev, action: "publish", runAt }),
    );
    expect(made).toMatchObject({
      status: 200,
      body: { kind: "ok", schedule: { action: "publish", runAt, status: "pending" } },
    });
    const read = await json(await call("GET", a, a.pageId, aPost.id));
    expect(read.body).toMatchObject({
      kind: "ok",
      rev: aPost.rev,
      schedules: [expect.objectContaining({ status: "pending" })],
    });
    const site = await json(
      await siteRoute.GET(
        new NextRequest(`${ORIGIN}/api/pages/${a.pageId}/schedules`, {
          headers: { origin: ORIGIN },
        }),
        { params: Promise.resolve({ id: a.pageId }) },
      ),
    );
    expect(site.body.entries[aPost.id]).toMatchObject({
      publishAt: runAt,
      scheduledRev: aPost.rev,
    });
    const stale = await json(
      await call("DELETE", a, a.pageId, aPost.id, { rev: aPost.rev + 5, action: "publish" }),
    );
    expect(stale).toMatchObject({ status: 409, body: { kind: "conflict", currentRev: aPost.rev } });
    const canceled = await json(
      await call("DELETE", a, a.pageId, aPost.id, { rev: aPost.rev, action: "publish" }),
    );
    expect(canceled).toMatchObject({ status: 200, body: { kind: "ok", canceled: true } });
  });

  it("M20-07 another user's entry answers exactly what an unknown one does", async () => {
    const theirs = await json(
      await call("POST", b, a.pageId, aPost.id, { rev: 1, action: "publish", runAt: ahead(10) }),
    );
    const theirsOwnSite = await json(
      await call("POST", b, b.pageId, aPost.id, { rev: 1, action: "publish", runAt: ahead(10) }),
    );
    const unknown = await json(
      await call("POST", b, b.pageId, "00000000-0000-4000-8000-00000000beef", {
        rev: 1,
        action: "publish",
        runAt: ahead(10),
      }),
    );
    expect(theirs).toEqual({ status: 404, body: { kind: "missing" } });
    expect(theirsOwnSite).toEqual(unknown);
    expect((await json(await call("GET", b, a.pageId, aPost.id))).body).toEqual({
      kind: "missing",
    });
    expect(
      (
        await json(
          await siteRoute.GET(
            new NextRequest(`${ORIGIN}/api/pages/${a.pageId}/schedules`, {
              headers: { origin: ORIGIN },
            }),
            { params: Promise.resolve({ id: a.pageId }) },
          ),
        )
      ).body,
    ).toEqual({ kind: "missing" });
  });

  it("M20-07 a page entry of another site is missing, even for its own owner under the wrong site", async () => {
    expect(
      await json(
        await call("POST", b, a.pageId, bPage.id, {
          rev: bPage.rev,
          action: "publish",
          runAt: ahead(10),
        }),
      ),
    ).toEqual({ status: 404, body: { kind: "missing" } });
  });

  it("M20-07 a foreign Origin, a wrong content type and no session are refused before anything is read", async () => {
    expect(
      (
        await call(
          "POST",
          a,
          a.pageId,
          aPost.id,
          { rev: 1, action: "publish", runAt: ahead(10) },
          { origin: "https://evil.example", "content-type": "application/json" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          a,
          a.pageId,
          aPost.id,
          { rev: 1, action: "publish", runAt: ahead(10) },
          { origin: ORIGIN, "content-type": "text/plain" },
        )
      ).status,
    ).toBe(415);
    mocks.user = null;
    const request = new NextRequest(
      `${ORIGIN}/api/pages/${a.pageId}/entries/${aPost.id}/schedule`,
      { method: "GET", headers: { origin: ORIGIN } },
    );
    expect(
      (await route.GET(request, { params: Promise.resolve({ id: a.pageId, entryId: aPost.id }) }))
        .status,
    ).toBe(401);
  });

  it("M20-07 a suspended account is refused", async () => {
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    try {
      expect(
        await json(
          await call("POST", a, a.pageId, aPost.id, {
            rev: aPost.rev,
            action: "publish",
            runAt: ahead(10),
          }),
        ),
      ).toMatchObject({ status: 403, body: { kind: "suspended" } });
    } finally {
      await admin.from("accounts").update({ suspended_at: null }).eq("id", a.userId);
    }
  });

  it("M20-09 Home cannot be scheduled to unpublish", async () => {
    const out = await json(
      await call("POST", a, a.pageId, aHome.id, {
        rev: aHome.rev,
        action: "unpublish",
        runAt: ahead(10),
      }),
    );
    expect(out).toMatchObject({
      status: 422,
      body: { kind: "invalid", message: "Home can’t be scheduled to unpublish." },
    });
  });

  it("M20-07 an unpublishable draft is refused with typed issues; a bad time and a Free plan have their own answers", async () => {
    const untitled = await insert(a, "post", { slug: "untitled-route" });
    const refused = await json(
      await call("POST", a, a.pageId, untitled.id, {
        rev: untitled.rev,
        action: "publish",
        runAt: ahead(10),
      }),
    );
    expect(refused.status).toBe(422);
    expect(refused.body.kind).toBe("invalid");
    expect(refused.body.issues.length).toBeGreaterThan(0);
    expect(
      await json(
        await call("POST", a, a.pageId, aPost.id, {
          rev: aPost.rev,
          action: "publish",
          runAt: "2020-01-01T00:00:00Z",
        }),
      ),
    ).toMatchObject({ status: 400, body: { kind: "time" } });
    expect(
      await json(
        await call("POST", a, a.pageId, aPost.id, {
          rev: aPost.rev,
          action: "later",
          runAt: ahead(10),
        }),
      ),
    ).toMatchObject({ status: 422, body: { kind: "invalid" } });
    const freePost = await insert(free, "post", { title: "Free", slug: "free-route" });
    expect(
      await json(
        await call("POST", free, free.pageId, freePost.id, {
          rev: freePost.rev,
          action: "publish",
          runAt: ahead(10),
        }),
      ),
    ).toMatchObject({ status: 403, body: { kind: "plan" } });
  });

  it("M20-12 bodies go through the shared schema: a wrong type for rev, action or runAt is refused before anything is read", async () => {
    const bad: Array<[unknown, number, string]> = [
      [{ rev: String(aPost.rev), action: "publish", runAt: ahead(10) }, 422, "invalid"],
      [{ rev: 1.5, action: "publish", runAt: ahead(10) }, 422, "invalid"],
      [{ rev: aPost.rev, action: ["publish"], runAt: ahead(10) }, 422, "invalid"],
      [{ rev: aPost.rev, action: "publish", runAt: 1_800_000_000_000 }, 400, "time"],
      [{ rev: aPost.rev, action: "publish", runAt: "x".repeat(41) }, 400, "time"],
    ];
    for (const [body, status, kind] of bad) {
      expect(
        await json(await call("POST", a, a.pageId, aPost.id, body)),
        JSON.stringify(body),
      ).toMatchObject({ status, body: { kind } });
    }
    expect(
      await json(await call("DELETE", a, a.pageId, aPost.id, { rev: aPost.rev })),
    ).toMatchObject({ status: 422, body: { kind: "invalid" } });
    expect(
      (
        await admin
          .from("content_schedules")
          .select("id")
          .eq("entry_id", aPost.id)
          .eq("status", "pending")
      ).data,
    ).toEqual([]);
  });

  it("M20-12 schedule writes are rate limited per account: past the limit a minute, 429 and nothing changes", async () => {
    const { SCHEDULE_RATE_LIMIT } = await import("@/lib/schedule/routes-core");
    const limited = await makeOwner(admin as never, "m20r-rate", undefined, "pro");
    owners.push(limited);
    await enablePost(admin, limited.pageId);
    const mine = await insert(limited, "post", { title: "Rate", slug: "rate" });
    for (let i = 0; i < SCHEDULE_RATE_LIMIT; i += 1) {
      expect(
        (
          await call("DELETE", limited, limited.pageId, mine.id, {
            rev: mine.rev,
            action: "publish",
          })
        ).status,
      ).toBe(200);
    }
    const over = await json(
      await call("POST", limited, limited.pageId, mine.id, {
        rev: mine.rev,
        action: "publish",
        runAt: ahead(10),
      }),
    );
    expect(over).toMatchObject({ status: 429, body: { kind: "limit" } });
    expect(
      (await admin.from("content_schedules").select("id").eq("entry_id", mine.id)).data,
    ).toEqual([]);
  }, 60_000);
});
