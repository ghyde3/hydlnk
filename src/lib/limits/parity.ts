import {
  PLAN_IDS,
  PLAN_LIMITS,
  SQL_COLUMNS,
  type LimitKey,
  type PlanId,
  type PlanLimits,
} from "./table";

/**
 * The parity check between the TypeScript table and `public.plan_limits()` (M4-02). Pure: the caller
 * fetches one row per plan from Postgres (`rows[plan]` is the object `select * from plan_limits(plan)`
 * returns, columns as keys) and gets back every difference. An empty list means the two agree.
 *
 * It reports four kinds of drift: a plan with no row, a column the table maps but the row lacks, a
 * value that differs (unlimited is `null` on both sides), and a column the function returns that the
 * table does not know (a limit added in SQL only).
 */

export interface LimitMismatch {
  plan: PlanId;
  /** The limit's key in the TypeScript table, or the stray SQL column name. */
  limit: string;
  column: string;
  expected: unknown;
  actual: unknown;
  kind: "missing_plan" | "missing_column" | "value" | "unknown_column";
}

export type LimitTable = Readonly<Record<PlanId, Readonly<PlanLimits>>>;
export type PlanLimitRows = Readonly<
  Partial<Record<PlanId, Readonly<Record<string, unknown>> | null>>
>;

export function comparePlanLimits(
  table: LimitTable = PLAN_LIMITS,
  rows: PlanLimitRows,
): LimitMismatch[] {
  const mismatches: LimitMismatch[] = [];
  const keys = Object.keys(SQL_COLUMNS) as LimitKey[];
  const known = new Set<string>(Object.values(SQL_COLUMNS));

  for (const plan of PLAN_IDS) {
    const row = rows[plan];
    if (!row) {
      mismatches.push({
        plan,
        limit: "*",
        column: "*",
        expected: "a row",
        actual: row ?? null,
        kind: "missing_plan",
      });
      continue;
    }
    for (const key of keys) {
      const column = SQL_COLUMNS[key];
      const expected = table[plan][key];
      if (!(column in row)) {
        mismatches.push({
          plan,
          limit: key,
          column,
          expected,
          actual: undefined,
          kind: "missing_column",
        });
        continue;
      }
      // PostgREST sends bigint as a JSON number; a stringified bigint would still be the same value.
      const raw = row[column];
      const actual = typeof raw === "string" && /^-?\d+$/.test(raw) ? Number(raw) : raw;
      if (actual !== expected) {
        mismatches.push({ plan, limit: key, column, expected, actual, kind: "value" });
      }
    }
    for (const column of Object.keys(row)) {
      if (!known.has(column)) {
        mismatches.push({
          plan,
          limit: column,
          column,
          expected: undefined,
          actual: row[column],
          kind: "unknown_column",
        });
      }
    }
  }
  return mismatches;
}
