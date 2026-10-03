import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The handle of a page, or null. Only the OG image of a custom domain needs it (it draws the same
 * picture as the handle host, from the same inputs, so both share one cache entry).
 */
export async function lookupHandleByPageId(pageId: string): Promise<string | null> {
  if (!PAGE_ID.test(pageId)) return null;
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("handle")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Looking up the handle of page ${pageId} failed: ${error.message}`);
  return data?.handle ?? null;
}
