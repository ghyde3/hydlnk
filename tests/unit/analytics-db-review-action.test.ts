import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeAdminAction } from "@/lib/admin/execute";
import { ANONYMOUS, type Principal } from "@/lib/admin/principal";
import type { AdminDeps } from "@/lib/admin/types";
import { reviewTrafficFlagAction } from "@/lib/analytics/admin/review-flag-action";
import { toTrafficFlagRow, type RawTrafficFlag } from "@/lib/analytics/admin/view";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M5-10: "Mark reviewed". The action goes through the same guard as every admin mutation
 * (executeAdminAction): nobody signed in is a 401 and a signed-in non-admin a 403, both before the
 * database is built, let alone touched. The real action then runs against the local Supabase stack.
 */
const { run } = await stackIsUp();

const ADMIN: Principal = {
  kind: "user",
  id: "11111111-2222-4333-8444-555555555555",
  email: "admin@example.test",
  admin: true,
};
const NON_ADMIN: Principal = {
  kind: "user",
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  email: "n@x.test",
  admin: false,
};
const TARGET = "00000000-0000-4000-8000-0000000000aa";

function untouchedDeps() {
  const touched: string[] = [];
  const db = new Proxy(
    {},
    {
      get(_target, property) {
        touched.push(String(property));
        throw new Error(`the database was touched (${String(property)})`);
      },
    },
  );
  const makeDeps = vi.fn((): AdminDeps => ({
    db: db as never,
    invalidateAccount: vi.fn(async () => 0),
    invalidateHandles: vi.fn(),
    isProtectedAccount: vi.fn(async () => false),
    now: () => new Date(),
  }));
  return { makeDeps, touched };
}

describe("M5-10 the review action is guarded like every admin mutation", () => {
  it("has its own stable name", () => {
    expect(reviewTrafficFlagAction.name).toBe("review_traffic_flag");
  });

  it("nobody signed in gets 401, no database built or touched", async () => {
    const { makeDeps, touched } = untouchedDeps();
    for (const input of [{ id: TARGET }, {}, null, "x", { id: ["a"] }]) {
      const result = await executeAdminAction(reviewTrafficFlagAction, ANONYMOUS, input, makeDeps);
      expect(result).toMatchObject({ ok: false, status: 401, error: "unauthenticated" });
    }
    expect(makeDeps).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it("a signed-in non-admin gets 403, no database built or touched", async () => {
    const { makeDeps, touched } = untouchedDeps();
    for (const input of [{ id: TARGET }, {}, null, "x", { id: ["a"], admin: true }]) {
      const result = await executeAdminAction(reviewTrafficFlagAction, NON_ADMIN, input, makeDeps);
      expect(result).toMatchObject({ ok: false, status: 403, error: "forbidden" });
    }
    expect(makeDeps).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it("an admin with a bad id gets 400, and a good id reaches the database (a 500 here, nothing leaked)", async () => {
    const { makeDeps } = untouchedDeps();
    for (const input of [{}, null, "x", { id: "not-a-uuid" }, { id: 5 }, { id: ["a"] }]) {
      const result = await executeAdminAction(reviewTrafficFlagAction, ADMIN, input, makeDeps);
      expect(result).toMatchObject({ ok: false, status: 400, error: "invalid_input" });
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await executeAdminAction(
      reviewTrafficFlagAction,
      ADMIN,
      { id: TARGET },
      makeDeps,
    );
    spy.mockRestore();
    expect(makeDeps).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: 500, error: "action_failed" });
    expect(JSON.stringify(result)).not.toContain("touched");
  });

  it("the action file imports nothing from the admin library but its types (the admin guard test allows only src/lib/admin and the admin routes to import actions, deps, execute and route)", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/analytics/admin/review-flag-action.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.filter((spec) => spec!.startsWith("@/lib/admin"))).toEqual([
      "@/lib/admin/types",
    ]);
  });

  it("the page asks requireAdmin before it reads anything", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(editor)/app/admin/traffic/page.tsx"),
      "utf8",
    );
    const gate = source.indexOf("await requireAdmin()");
    const read = source.indexOf("await listTrafficFlags(");
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(gate);
  });
});

describe.skipIf(!run)("M5-10 mark reviewed (local Supabase)", () => {
  let admin: SupabaseClient;
  let owner: TestOwner;
  let flagId = "";

  const deps = (): AdminDeps => ({
    db: admin as never,
    invalidateAccount: async () => 0,
    invalidateHandles: () => undefined,
    isProtectedAccount: async () => false,
    now: () => new Date(),
  });

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    owner = await makeOwner(admin, "tfrev");
    // 1,234 views yesterday, rolled up, then flagged with a 1,000 threshold: the real pipeline
    // (events -> rollup -> flag) without 100,000 rows.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const rows = Array.from({ length: 1234 }, (_, i) => ({
      page_id: owner.pageId,
      block_id: "",
      type: "view",
      ts: `${yesterday}T12:00:00Z`,
      referrer: "example.com",
      device: "mobile",
      country: "US",
      visitor_hash: `v${i % 200}`,
    }));
    const insert = await admin.from("events").insert(rows);
    expect(insert.error).toBeNull();
    const rolled = await admin.rpc("rollup_daily_stats", { p_day: yesterday });
    expect(rolled.error).toBeNull();
    const flagged = await admin.rpc("flag_high_traffic_pages", { threshold: 1000 });
    expect(flagged.error).toBeNull();
    const flag = await admin
      .from("traffic_flags")
      .select("id")
      .eq("page_id", owner.pageId)
      .single();
    expect(flag.error).toBeNull();
    flagId = flag.data!.id as string;
  });

  afterAll(async () => {
    if (owner) await removeOwners(admin, [owner]);
  });

  it("the admin list function returns the flag with its page, owner email, plan and views", async () => {
    const listed = await admin.rpc("admin_traffic_flags", {
      p_reviewed: false,
      p_limit: 200,
      p_offset: 0,
    });
    expect(listed.error).toBeNull();
    const row = (listed.data as RawTrafficFlag[]).find((r) => r.flag_id === flagId);
    expect(row).toBeDefined();
    expect(toTrafficFlagRow(row!)).toMatchObject({
      handle: owner.handle,
      ownerEmail: owner.email,
      plan: "free",
      views: 1234,
      reviewedAt: null,
    });
  });

  it("marks the flag reviewed once, keeps the first timestamp and answers changed: false the second time", async () => {
    const first = await executeAdminAction(reviewTrafficFlagAction, ADMIN, { id: flagId }, deps);
    expect(first).toMatchObject({ ok: true, status: 200, data: { changed: true } });
    const after = await admin.from("traffic_flags").select("reviewed_at").eq("id", flagId).single();
    const stamp = after.data!.reviewed_at as string;
    expect(stamp).not.toBeNull();

    const second = await executeAdminAction(reviewTrafficFlagAction, ADMIN, { id: flagId }, deps);
    expect(second).toMatchObject({ ok: true, status: 200, data: { changed: false } });
    const again = await admin.from("traffic_flags").select("reviewed_at").eq("id", flagId).single();
    expect(again.data!.reviewed_at).toBe(stamp);
  });

  it("the reviewed flag leaves the unreviewed list and joins the reviewed one", async () => {
    const open = await admin.rpc("admin_traffic_flags", {
      p_reviewed: false,
      p_limit: 200,
      p_offset: 0,
    });
    expect((open.data as RawTrafficFlag[]).some((r) => r.flag_id === flagId)).toBe(false);
    const done = await admin.rpc("admin_traffic_flags", {
      p_reviewed: true,
      p_limit: 200,
      p_offset: 0,
    });
    expect((done.data as RawTrafficFlag[]).some((r) => r.flag_id === flagId)).toBe(true);
  });

  it("a flag that does not exist is a 404, and marking never touches the page", async () => {
    const missing = await executeAdminAction(
      reviewTrafficFlagAction,
      ADMIN,
      { id: "00000000-0000-4000-8000-00000000dead" },
      deps,
    );
    expect(missing).toMatchObject({ ok: false, status: 404, error: "not_found" });
    const page = await admin.from("pages").select("id").eq("id", owner.pageId).single();
    expect(page.error).toBeNull();
  });

  it("a signed-in non-admin gets 403 even for a real flag", async () => {
    const result = await executeAdminAction(
      reviewTrafficFlagAction,
      NON_ADMIN,
      { id: flagId },
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
