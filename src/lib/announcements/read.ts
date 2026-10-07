import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

export interface ActiveAnnouncement {
  id: string;
  message: string;
  link: string | null;
  startsAt: string;
  endsAt: string;
}

/**
 * The announcement a signed-in owner sees (M13-09), read with the owner's own session: RLS lets
 * `authenticated` read only the row whose window contains now (and only these columns), so the time
 * window is enforced by the database, not here. `anon` reads nothing, so no public page can show it.
 * A failed read is no banner, never an error page.
 */
export async function readActiveAnnouncement(): Promise<ActiveAnnouncement | null> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("announcements")
      .select("id, message, link, starts_at, ends_at")
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      message: data.message,
      link: data.link,
      startsAt: data.starts_at,
      endsAt: data.ends_at,
    };
  } catch {
    return null;
  }
}
