// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";
import { fixtureUsers, teamFixture, type TeamFixture } from "./m19t-team-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

/**
 * R13 (M19-02, M19-06): TypeScript's decide() and SQL's need_met are two readings of one rule. For
 * every role (owner, publisher, editor), every state the rule can give (active, paused_plan,
 * paused_owner, suspended_self) and every need (read, edit, publish, owner), the TS verdict on the row
 * `site_access` returns must equal what `require_site_access` (need_met inside the database) answers.
 * A change to either side that the other does not make fails here.
 */
const { run } = await stackIsUp();
const { decide } = await import("@/lib/access/decide");

const NEEDS = ["read", "edit", "publish", "owner"] as const;

describe.skipIf(!run)("R13 decide() and need_met agree on every role, state and need (local Supabase)", () => {
  let admin: SupabaseClient;
  let f: TeamFixture;

  beforeAll(async () => {
    admin = adminClient();
    f = await teamFixture(admin, "m19par");
  });
  afterAll(async () => {
    if (f) await removeOwners(admin, fixtureUsers(f));
  });

  const set = async (id: string, change: Record<string, unknown>) => {
    const { error } = await admin.from("accounts").update(change).eq("id", id);
    if (error) throw new Error(error.message);
  };

  /** Each state, entered and left again. */
  const STATES: Array<{ state: string; enter: () => Promise<void>; leave: () => Promise<void> }> = [
    { state: "active", enter: async () => undefined, leave: async () => undefined },
    {
      state: "paused_plan",
      enter: () => set(f.owner.userId, { paid_plan: "pro" }),
      leave: () => set(f.owner.userId, { paid_plan: "studio" }),
    },
    {
      state: "paused_owner",
      enter: () => set(f.owner.userId, { suspended_at: new Date().toISOString() }),
      leave: () => set(f.owner.userId, { suspended_at: null }),
    },
    {
      state: "suspended_self",
      enter: async () => {
        for (const u of [f.owner, f.editor, f.publisher]) await set(u.userId, { suspended_at: new Date().toISOString() });
      },
      leave: async () => {
        for (const u of [f.owner, f.editor, f.publisher]) await set(u.userId, { suspended_at: null });
      },
    },
  ];

  it("every (role, state, need): the TS verdict equals the database's", async () => {
    const seen = new Set<string>();
    const mismatches: string[] = [];
    for (const { state, enter, leave } of STATES) {
      await enter();
      try {
        for (const [role, user] of [["owner", f.owner], ["publisher", f.publisher], ["editor", f.editor]] as const) {
          const read = await admin.rpc("site_access", { p_site: f.owner.pageId, p_user: user.userId });
          if (read.error) throw new Error(read.error.message);
          const row = (read.data as Array<Record<string, unknown>>)[0] ?? null;
          if (row) seen.add(`${role}:${String(row.state)}`);
          for (const need of NEEDS) {
            const ts = decide(row as never, need, "editor") === "ok";
            const sql = await admin.rpc("require_site_access", {
              p_site: f.owner.pageId,
              p_user: user.userId,
              p_need: need,
            });
            if (sql.error && sql.error.code !== "P0002") throw new Error(sql.error.message);
            const db = !sql.error;
            if (ts !== db) mismatches.push(`${role} ${state} ${need}: decide ${ts}, need_met ${db}`);
          }
        }
      } finally {
        await leave();
      }
    }
    expect(mismatches).toEqual([]);
    // The fixture really reached every state the rule can give (the owner is never paused).
    expect([...seen].sort()).toEqual(
      [
        "editor:active", "editor:paused_owner", "editor:paused_plan", "editor:suspended_self",
        "owner:active", "owner:suspended_self",
        "publisher:active", "publisher:paused_owner", "publisher:paused_plan", "publisher:suspended_self",
      ].sort(),
    );
  });

  it("an unknown need is an error in the database, never a silent no (TypeScript has no such need)", async () => {
    const sql = await admin.rpc("require_site_access", { p_site: f.owner.pageId, p_user: f.owner.userId, p_need: "admin" });
    expect(sql.error?.code).toBe("22023");
  });
});
