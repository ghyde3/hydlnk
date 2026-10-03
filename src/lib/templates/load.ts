import "server-only";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import { createServerSupabase } from "@/lib/supabase/server";
import { TEMPLATES } from "./catalog";

/**
 * The token sets of the six themes the templates use, by theme id, for the editor (M6-40): the
 * preview shows a template's theme the moment it is applied, and the template cards draw its
 * background and accent colors. Read with the signed-in user's own session and the publishable key
 * (system themes are readable by everyone), never the secret key. A row that does not parse is
 * left out, so its theme reads as the default; a read that fails answers `{}` and the editor
 * works as before (an applied template then shows the default colors until the page is reloaded).
 */
export async function loadTemplateThemes(): Promise<Record<string, Partial<TokenSet>>> {
  try {
    const supabase = await createServerSupabase();
    const ids = [...new Set(TEMPLATES.map((template) => template.theme.id))];
    const { data, error } = await supabase
      .from("themes")
      .select("id, tokens")
      .in("id", ids)
      .is("owner_id", null);
    if (error || !data) {
      console.error("[editor] loading the template themes failed", error?.message);
      return {};
    }
    const out: Record<string, Partial<TokenSet>> = {};
    for (const row of data) {
      const parsed = tokenSetSchema.partial().safeParse(row.tokens);
      if (parsed.success) out[row.id] = parsed.data;
    }
    return out;
  } catch (error) {
    console.error("[editor] loading the template themes failed", error);
    return {};
  }
}
