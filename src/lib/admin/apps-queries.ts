import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { AppRow } from "./apps-view";

/** The reads behind /admin/apps (M13-10): `admin_oauth_apps`, counts only, busiest first. */
export async function listConnectedApps(limit = 200): Promise<AppRow[]> {
  const db = createAdminSupabase();
  const { data, error } = await db.rpc("admin_oauth_apps", { p_limit: limit });
  if (error) throw new Error(`Listing connected apps failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    clientId: row.client_id,
    name: row.client_name,
    kind: row.kind === "cimd" ? "cimd" : "dcr",
    blockedAt: row.blocked_at,
    blockedReason: row.blocked_reason,
    activeConnections: Number(row.active_connections),
    calls7d: Number(row.calls_7d),
    errors7d: Number(row.errors_7d),
    lastCallAt: row.last_call_at,
  }));
}
