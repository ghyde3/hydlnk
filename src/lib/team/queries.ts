import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadTeamCore, type TeamData } from "./core";

/** The members screen's data for the owner of `siteId` (null for anyone else: the SQL decides). */
export function loadTeam(actorId: string, siteId: string): Promise<TeamData | null> {
  return loadTeamCore(createAdminSupabase(), { actorId, siteId });
}
