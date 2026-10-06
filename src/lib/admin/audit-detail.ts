import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/supabase/database.types";
import type { AdminActionContext } from "./types";

/**
 * The audit helpers of the actions that name a thing by a text key in `detail` (a handle, an OAuth
 * client id, an announcement id) rather than by an account or a report (M13-08 to M13-10). The rule
 * is the one of every admin mutation: the change first, then its `admin_audit` row, and a failure to
 * write the row fails the action (500); the retry finds the change made and writes the missing row.
 */

export type LooseDb = SupabaseClient;

export const looseDb = (context: AdminActionContext): LooseDb =>
  context.deps.db as unknown as LooseDb;

export async function writeAudit(
  db: LooseDb,
  adminId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("admin_audit").insert({
    admin_id: adminId,
    action,
    account_id: null,
    report_id: null,
    detail: detail as Json,
  });
  if (error) throw new Error(`Writing the audit log failed: ${error.message}`);
}

/** The newest audit row among `actions` whose `detail[key]` equals `value`, or null. */
export async function latestAudit(
  db: LooseDb,
  actions: readonly string[],
  key: string,
  value: string,
): Promise<{ action: string; detail: Record<string, unknown> } | null> {
  const { data, error } = await db
    .from("admin_audit")
    .select("action, detail")
    .in("action", [...actions])
    .eq(`detail->>${key}`, value)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the audit log failed: ${error.message}`);
  const row = data as { action: string; detail: Record<string, unknown> | null } | null;
  return row ? { action: row.action, detail: row.detail ?? {} } : null;
}
