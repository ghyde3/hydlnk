import { createBrowserSupabase } from "@/lib/supabase/browser";

/** The `rev` of every page entry of a site, read with the signed-in session under RLS. Null when the read fails. */
export async function readEntryRevs(siteId: string): Promise<{ id: string; rev: number }[] | null> {
  const { data, error } = await createBrowserSupabase()
    .from("content_entries")
    .select("id, rev")
    .eq("site_id", siteId);
  if (error || !data) return null;
  return data.map((row) => ({ id: row.id, rev: Number(row.rev) }));
}
