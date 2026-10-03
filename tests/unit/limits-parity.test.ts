import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLAN_IDS,
  PLAN_LIMITS,
  SQL_COLUMNS,
  comparePlanLimits,
  type PlanId,
  type PlanLimitRows,
} from "@/lib/limits";
import { rand, stackIsUp } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M4-02: the TypeScript table and Postgres' `plan_limits()` hold the same numbers. The first test
 * loops over every plan and limit and calls the function on the local stack; the second proves the
 * check actually reports a mismatch (a copy of the table with one number changed); the rest are the
 * direct-API checks (the publishable key sees only the public numbers, an unknown plan fails closed).
 */
const { run } = await stackIsUp();

const SQL_ROW_KEYS = Object.values(SQL_COLUMNS).sort();

describe("M4-02 comparePlanLimits (pure)", () => {
  const rowsFromTable = (): Record<PlanId, Record<string, unknown>> =>
    Object.fromEntries(
      PLAN_IDS.map((plan) => [
        plan,
        Object.fromEntries(
          (Object.keys(SQL_COLUMNS) as (keyof typeof SQL_COLUMNS)[]).map((key) => [
            SQL_COLUMNS[key],
            PLAN_LIMITS[plan][key],
          ]),
        ),
      ]),
    ) as Record<PlanId, Record<string, unknown>>;

  it("M4-02 reports nothing when the rows mirror the table", () => {
    expect(comparePlanLimits(PLAN_LIMITS, rowsFromTable())).toEqual([]);
  });

  it("M4-02 reports a changed number, a changed null, a missing plan, a missing column and a stray column", () => {
    const rows = rowsFromTable();
    rows.pro!.max_pages = 4;
    rows.studio!.max_saved_themes = 100;
    rows.free!.extra_limit = 1;
    delete rows.free!.max_domains;
    delete (rows as Partial<typeof rows>).studio;

    const found = comparePlanLimits(PLAN_LIMITS, rows);
    const kinds = found.map((m) => `${m.plan}:${m.kind}:${m.column}`).sort();
    expect(kinds).toEqual(
      [
        "free:missing_column:max_domains",
        "free:unknown_column:extra_limit",
        "pro:value:max_pages",
        "studio:missing_plan:*",
      ].sort(),
    );
  });
});

describe.skipIf(!run)("M4-02 plan_limits() parity (local Supabase)", () => {
  let admin: SupabaseClient;
  const userIds: string[] = [];

  async function fetchRows(plans: readonly PlanId[] = PLAN_IDS): Promise<PlanLimitRows> {
    const rows: Partial<Record<PlanId, Record<string, unknown>>> = {};
    for (const plan of plans) {
      const { data, error } = await admin.rpc("plan_limits", { p_plan: plan });
      expect(error, `plan_limits(${plan})`).toBeNull();
      expect(Array.isArray(data) ? data : [data]).toHaveLength(1);
      rows[plan] = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    }
    return rows;
  }

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id).catch(() => undefined)));
  });

  it("M4-02 every plan and every limit in the TypeScript table equals what plan_limits() returns", async () => {
    const rows = await fetchRows();
    // Spell the loop out so a failure names the plan and limit.
    for (const plan of PLAN_IDS) {
      const row = rows[plan]!;
      expect(Object.keys(row).sort(), `${plan}: columns`).toEqual(SQL_ROW_KEYS);
      for (const key of Object.keys(SQL_COLUMNS) as (keyof typeof SQL_COLUMNS)[]) {
        expect(row[SQL_COLUMNS[key]], `${plan}.${key}`).toBe(PLAN_LIMITS[plan][key]);
      }
    }
    expect(comparePlanLimits(PLAN_LIMITS, rows)).toEqual([]);
  });

  it("M4-02 a mutated copy of the TypeScript table makes the parity check report the mismatch", async () => {
    const rows = await fetchRows();
    const mutated = {
      ...PLAN_LIMITS,
      pro: {
        ...PLAN_LIMITS.pro,
        pages: PLAN_LIMITS.pro.pages + 1,
        // M6-48: the number of published versions kept is part of the same table.
        versionsKept: PLAN_LIMITS.pro.versionsKept + 1,
      },
      studio: { ...PLAN_LIMITS.studio, savedThemes: 50 },
    };
    const found = comparePlanLimits(mutated, rows);
    expect(found.map((m) => `${m.plan}.${m.limit}`).sort()).toEqual([
      "pro.pages",
      "pro.versionsKept",
      "studio.savedThemes",
    ]);
    expect(found.find((m) => m.limit === "versionsKept")).toMatchObject({
      expected: 26,
      actual: 25,
      column: "versions_kept",
      kind: "value",
    });
    expect(found.find((m) => m.limit === "pages")).toMatchObject({
      expected: 4,
      actual: 3,
      column: "max_pages",
      kind: "value",
    });
  });

  it("M4-02 unlimited saved themes is null in the database", async () => {
    const rows = await fetchRows(["free", "pro", "studio"]);
    expect(rows.free!.max_saved_themes).toBe(3);
    expect(rows.pro!.max_saved_themes).toBeNull();
    expect(rows.studio!.max_saved_themes).toBeNull();
  });

  it("M4-02 POST /rest/v1/rpc/plan_limits with the publishable key returns only the public numbers", async () => {
    for (const plan of PLAN_IDS) {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/plan_limits`, {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_plan: plan }),
      });
      expect(res.status, `plan_limits(${plan}) as anon`).toBe(200);
      const body = (await res.json()) as Record<string, unknown>[];
      expect(body).toHaveLength(1);
      // Exactly the plan's public numbers: no account id, email, plan owner or any other column.
      expect(Object.keys(body[0]!).sort()).toEqual(SQL_ROW_KEYS);
      expect(comparePlanLimits(PLAN_LIMITS, { ...(await fetchRows()), [plan]: body[0]! })).toEqual(
        [],
      );
    }
  });

  it("M4-02 plan_limits('enterprise'), null and a wrong-case name raise instead of defaulting", async () => {
    for (const bad of ["enterprise", "FREE", "", "free "]) {
      const { data, error } = await admin.rpc("plan_limits", { p_plan: bad });
      expect(error, `plan_limits(${JSON.stringify(bad)})`).not.toBeNull();
      expect(data).toBeNull();
      expect(error!.code).toBe("22023");
    }
    const { error } = await admin.rpc("plan_limits", { p_plan: null });
    expect(error?.code).toBe("22023");
  });

  it("M4-02 accounts.plan rejects any value other than free, pro or studio", async () => {
    const email = `zq-planchk-${rand()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    userIds.push(id);
    for (const plan of ["enterprise", "Pro", "", "gold"]) {
      const { error } = await admin.from("accounts").update({ plan }).eq("id", id);
      expect(error?.code, `plan ${JSON.stringify(plan)}`).toBe("23514");
    }
    const row = await admin.from("accounts").select("plan").eq("id", id).single();
    expect(row.data?.plan).toBe("free");
  });
});
