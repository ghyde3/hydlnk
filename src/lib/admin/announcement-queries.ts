import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export interface AdminAnnouncement {
  id: string;
  message: string;
  link: string | null;
  startsAt: string;
  endsAt: string;
  /** Its start has passed, by the clock of the read. */
  showing: boolean;
}

/**
 * The announcements on /admin/announcement (M13-09): the one showing now and any scheduled after it
 * (setting a later one ends the current one at the new start, it does not replace it), earliest first.
 */
export async function readCurrentAnnouncements(): Promise<AdminAnnouncement[]> {
  const db = createAdminSupabase();
  const { data, error } = await db
    .from("announcements")
    .select("id, message, link, starts_at, ends_at")
    .gt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(`Reading the announcement failed: ${error.message}`);
  const now = Date.now();
  return (data ?? []).map((row) => ({
    id: row.id,
    message: row.message,
    link: row.link,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    showing: Date.parse(row.starts_at) <= now,
  }));
}
