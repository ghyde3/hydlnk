import { describe, expect, it } from "vitest";
import { reviewTrafficFlagAction } from "@/lib/analytics/admin/review-flag-action";
import type { AdminActionContext } from "@/lib/admin/types";

/**
 * "Mark reviewed" is audited like the other admin actions: state first, then the admin_audit row;
 * an audit failure fails the action (500) and the retry, which sees the flag already reviewed,
 * writes the missing row; a double click writes nothing.
 */

const FLAG = "00000000-0000-4000-8000-0000000000f1";
const PAGE = "00000000-0000-4000-8000-0000000000e1";
const OWNER = "00000000-0000-4000-8000-0000000000c1";
const ADMIN_ID = "11111111-2222-4333-8444-555555555555";

interface Flag { id: string; page_id: string; reviewed_at: string | null }

function fakeDb(options: { flags?: Flag[]; auditError?: boolean } = {}) {
  const flags: Flag[] = options.flags ?? [{ id: FLAG, page_id: PAGE, reviewed_at: null }];
  const audit: Record<string, unknown>[] = [];
  let auditFails = options.auditError ?? false;

  const flagQuery = () => {
    let patch: Partial<Flag> | null = null;
    const filters: ((f: Flag) => boolean)[] = [];
    let wantSelect = false;
    const run = () => {
      const rows = flags.filter((f) => filters.every((fn) => fn(f)));
      if (patch) for (const row of rows) Object.assign(row, patch);
      return rows;
    };
    const q = {
      update(p: Partial<Flag>) {
        patch = p;
        return q;
      },
      select() {
        wantSelect = true;
        return q;
      },
      eq(col: keyof Flag, value: unknown) {
        filters.push((f) => f[col] === value);
        return q;
      },
      is(col: keyof Flag, value: null) {
        filters.push((f) => f[col] === value);
        return q;
      },
      async maybeSingle() {
        return { data: run()[0] ?? null, error: null };
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: wantSelect || patch ? run() : [], error: null }).then(resolve);
      },
    };
    return q;
  };

  const db = {
    from(table: string) {
      if (table === "traffic_flags") return flagQuery();
      if (table === "pages") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { owner_id: OWNER }, error: null }) }),
          }),
        };
      }
      if (table === "admin_audit") {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (auditFails) return { error: { message: "audit down" } };
            audit.push(row);
            return { error: null };
          },
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: async () => ({
                  data: audit.filter((r) => (r.detail as { flag_id?: string }).flag_id === FLAG).slice(0, 1),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db, flags, audit, failAudit: (on: boolean) => void (auditFails = on) };
}

function context(db: unknown): AdminActionContext {
  return {
    actor: { id: ADMIN_ID, email: "admin@example.test" },
    deps: {
      db: db as never,
      invalidateAccount: async () => 0,
      invalidateHandles: () => undefined,
      isProtectedAccount: async () => false,
      now: () => new Date("2026-10-04T12:00:00Z"),
    },
  };
}

describe("Mark reviewed writes an admin_audit row", () => {
  it("one row, named review_traffic_flag, with the admin, the page owner and the flag", async () => {
    const f = fakeDb();
    const result = await reviewTrafficFlagAction.run(context(f.db), { id: FLAG });
    expect(result).toMatchObject({ ok: true, status: 200, data: { changed: true } });
    expect(f.audit).toEqual([
      {
        admin_id: ADMIN_ID,
        action: "review_traffic_flag",
        account_id: OWNER,
        report_id: null,
        detail: { flag_id: FLAG, page_id: PAGE },
      },
    ]);
  });

  it("a double click changes nothing and writes no second row", async () => {
    const f = fakeDb();
    await reviewTrafficFlagAction.run(context(f.db), { id: FLAG });
    const second = await reviewTrafficFlagAction.run(context(f.db), { id: FLAG });
    expect(second).toMatchObject({ ok: true, data: { changed: false } });
    expect(f.audit).toHaveLength(1);
  });

  it("an audit failure fails the action, and the retry writes the missing row once", async () => {
    const f = fakeDb({ auditError: true });
    await expect(reviewTrafficFlagAction.run(context(f.db), { id: FLAG })).rejects.toThrow(/audit log/);
    expect(f.flags[0]!.reviewed_at).not.toBeNull();
    expect(f.audit).toHaveLength(0);

    f.failAudit(false);
    const retry = await reviewTrafficFlagAction.run(context(f.db), { id: FLAG });
    expect(retry).toMatchObject({ ok: true, data: { changed: false } });
    expect(f.audit).toHaveLength(1);
    expect(f.audit[0]).toMatchObject({ action: "review_traffic_flag", detail: { flag_id: FLAG, retried: true } });

    await reviewTrafficFlagAction.run(context(f.db), { id: FLAG });
    expect(f.audit).toHaveLength(1);
  });

  it("a flag that does not exist is a 404 and writes nothing", async () => {
    const f = fakeDb({ flags: [] });
    const result = await reviewTrafficFlagAction.run(context(f.db), { id: FLAG });
    expect(result).toMatchObject({ ok: false, status: 404, error: "not_found" });
    expect(f.audit).toEqual([]);
  });
});
