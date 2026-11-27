import "server-only";
import { tokenSetSchema } from "@/lib/theme";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ThemeRow } from "./types";

/**
 * Every theme usable on the current site, system themes first and then the site OWNER's saved ones
 * (Wave F, C11: a member sees the owner's, never their own or a third account's), read with the
 * signed-in user's session and the publishable key (never the secret key): RLS decides what is
 * readable (themes_select_own, themes_select_shared), so a stranger's theme can never appear
 * (M3-19); the filter narrows it to this site's owner. `ownerId` is `current.access.ownerId`. A row
 * whose tokens do not parse reads as `{}` (the page resolves from the system default).
 */
export async function loadThemeLibrary(ownerId: string): Promise<ThemeRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("themes")
    .select("id, owner_id, name, tokens")
    .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
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
