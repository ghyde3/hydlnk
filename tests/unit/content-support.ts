import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/** The site's two built-in type rows (page and post). */
export async function contentTypes(admin: Admin, siteId: string) {
  const { data, error } = await admin.from("content_types").select("*").eq("site_id", siteId);
  if (error) throw new Error(`content_types: ${error.message}`);
  const page = data.find((t) => t.key === "page");
  const post = data.find((t) => t.key === "post");
  if (!page || !post) throw new Error("built-in content types missing");
  return { page, post };
}

/**
 * The one sanctioned test-only write to content_types: turn the post type on before T9's
 * enableType exists. The static test allows writes under tests/.
 */
export async function enablePost(admin: Admin, siteId: string): Promise<void> {
  const { error } = await admin
    .from("content_types")
    .update({ enabled: true })
    .eq("site_id", siteId)
    .eq("key", "post");
  if (error) throw new Error(`enablePost: ${error.message}`);
}
