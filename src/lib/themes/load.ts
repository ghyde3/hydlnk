import "server-only";
import { tokenSetSchema } from "@/lib/theme";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ThemeRow } from "./types";

/**
 * Every theme the signed-in user may use, system themes first and then their own saved ones, read
 * with their own session and the publishable key (never the secret key): RLS decides what is
 * readable, so another user's saved theme can never appear here (M3-19). A row whose tokens do not
 * parse reads as `{}` (the page resolves from the system default), like the editor's own loader.
 */
export async function loadThemeLibrary(): Promise<ThemeRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("themes")
    .select("id, owner_id, name, tokens")
    .order("owner_id", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`Loading the themes failed: ${error.message}`);
  return data.map((row) => {
    const tokens = tokenSetSchema.partial().safeParse(row.tokens);
    return {
      id: row.id,
      name: row.name,
      system: row.owner_id === null,
      tokens: tokens.success ? tokens.data : {},
    };
  });
}
