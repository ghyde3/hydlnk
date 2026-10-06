import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * The page's primary custom domain for the editor (M6-31, M6-33): the oldest verified domain of the
 * page, or null. It is `getPrimaryDomain`'s rule (src/lib/domains/primary.ts, which uses the secret
 * key) read with the signed-in owner's own session instead: `domains_select_own` lets an owner read
 * the domains of their own pages and nobody else's, so RLS decides. A failed read answers null (the
 * page's handle address is always live, so the QR code still opens it) and is logged.
 */
export async function loadPrimaryDomain(pageId: string): Promise<string | null> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("domains")
      .select("hostname")
      .eq("page_id", pageId)
      .eq("status", "verified")
      .order("verified_at", { ascending: true })
      .order("hostname", { ascending: true })
      .limit(1);
    if (error) {
      console.error("[editor] reading the page's domains failed", error.message);
      return null;
    }
    return data?.[0]?.hostname ?? null;
  } catch (error) {
    console.error("[editor] reading the page's domains failed", error);
    return null;
  }
}
