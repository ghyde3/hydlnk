import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import { SAVED_THEME_LIMIT_CODE } from "./limits";
import type { ThemeRow } from "./types";

/**
 * The saved-theme writes of the Design screen (M3-21 .. M3-24), each one a single request made
 * with the signed-in user's own session and the publishable key: RLS and the database triggers are
 * the permission system, never this module. It takes the client as an argument, so it is the same
 * code in the browser and under test, and it imports no secret-key client.
 *
 * Every function resolves (never throws) with `{ ok: true, ... }` or `{ ok: false, reason }`:
 *   limit    the plan's saved-theme limit trigger refused the insert (SQLSTATE HL002)
 *   invalid  a CHECK refused the row (a name over 40 characters, SQLSTATE 23514)
 *   denied   RLS refused the write (42501)
 *   missing  no row matched: already deleted, or not the caller's (RLS filters it out)
 *   error    anything else (network, server)
 */

type Client = SupabaseClient<Database>;

export type ThemeOpFailure = "limit" | "invalid" | "denied" | "missing" | "error";
export type ThemeOp = { ok: true; theme: ThemeRow } | { ok: false; reason: ThemeOpFailure };
export type ThemeDelete = { ok: true } | { ok: false; reason: ThemeOpFailure };

const COLUMNS = "id, owner_id, name, tokens";

interface RawRow {
  id: string;
  owner_id: string | null;
  name: string;
  tokens: Json;
}

/** A row read back from the database, as the Design screen holds it. */
export function toThemeRow(row: RawRow): ThemeRow {
  const tokens = tokenSetSchema.partial().safeParse(row.tokens);
  return {
    id: row.id,
    name: row.name,
    system: row.owner_id === null,
    tokens: tokens.success ? tokens.data : {},
  };
}

function failure(error: { code?: string } | null): ThemeOpFailure {
  switch (error?.code) {
    case SAVED_THEME_LIMIT_CODE:
      return "limit";
    case "23514":
      return "invalid";
    case "42501":
      return "denied";
    default:
      return "error";
  }
}

/** M3-21: a new saved theme for `ownerId` (the caller). Block-level overrides are never part of it. */
export async function insertSavedTheme(
  client: Client,
  ownerId: string,
  name: string,
  tokens: TokenSet,
): Promise<ThemeOp> {
  try {
    const { data, error } = await client
      .from("themes")
      .insert({ owner_id: ownerId, name, tokens: tokens as unknown as Json })
      .select(COLUMNS)
      .single();
    if (error || !data) return { ok: false, reason: failure(error) };
    return { ok: true, theme: toThemeRow(data) };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** M3-23: write resolved tokens into one of the caller's saved themes. */
export async function updateSavedThemeTokens(
  client: Client,
  id: string,
  tokens: TokenSet,
): Promise<ThemeOp> {
  return updateRow(client, id, { tokens: tokens as unknown as Json });
}

/** M3-23: rename one of the caller's saved themes (the tokens stay as they are). */
export async function renameSavedTheme(client: Client, id: string, name: string): Promise<ThemeOp> {
  return updateRow(client, id, { name });
}

async function updateRow(
  client: Client,
  id: string,
  patch: { name: string } | { tokens: Json },
): Promise<ThemeOp> {
  try {
    const { data, error } = await client.from("themes").update(patch).eq("id", id).select(COLUMNS);
    if (error) return { ok: false, reason: failure(error) };
    const row = data?.[0];
    // RLS hides a row that is not the caller's (and a system row): an update then matches nothing.
    if (!row) return { ok: false, reason: "missing" };
    return { ok: true, theme: toThemeRow(row) };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** M3-24: delete one of the caller's saved themes. */
export async function deleteSavedTheme(client: Client, id: string): Promise<ThemeDelete> {
  try {
    const { data, error } = await client.from("themes").delete().eq("id", id).select("id");
    if (error) return { ok: false, reason: failure(error) };
    if (!data || data.length === 0) return { ok: false, reason: "missing" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}
