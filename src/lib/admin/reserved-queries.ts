import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { RESERVED_PAGE_SIZE, type ReservedKind, type ReservedRow } from "./reserved-view";

/** The reads behind /admin/reserved (M13-08): one service-role function, `admin_list_reserved_handles`. */

export async function listReservedHandles(options: {
  query: string;
  kind: ReservedKind | null;
  page: number;
}): Promise<{ rows: ReservedRow[]; total: number }> {
  const db = createAdminSupabase();
  const { data, error } = await db.rpc("admin_list_reserved_handles", {
    p_query: options.query,
    p_kind: options.kind ?? undefined,
    p_limit: RESERVED_PAGE_SIZE,
    p_offset: (options.page - 1) * RESERVED_PAGE_SIZE,
  });
  if (error) throw new Error(`Listing reserved handles failed: ${error.message}`);
  const list = data ?? [];
  const adderIds = [...new Set(list.map((row) => row.added_by).filter((id): id is string => !!id))];
  const emails = new Map<string, string>();
  if (adderIds.length > 0) {
    const found = await db.rpc("admin_account_emails", { p_ids: adderIds });
    if (found.error) throw new Error(`Reading admin emails failed: ${found.error.message}`);
    for (const row of found.data ?? []) emails.set(row.id, row.email);
  }
  return {
    rows: list.map((row) => ({
      handle: row.handle,
      reason: row.reason,
      kind: row.kind === "system" ? "system" : "admin",
      addedBy: row.added_by,
      addedByEmail: row.added_by ? (emails.get(row.added_by) ?? null) : null,
      createdAt: row.created_at,
      held: row.holder_page_id !== null,
    })),
    total: Number(list[0]?.total_count ?? 0),
  };
}
