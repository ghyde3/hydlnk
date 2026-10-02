import type { TokenSet } from "@/lib/theme";

/**
 * One theme as the Design screen and the saved-themes card know it: a system theme (`owner_id`
 * null, read-only) or one of the signed-in user's own saved themes. `tokens` is whatever the row
 * holds, parsed as a partial token set: a row with missing keys still resolves (system default
 * fills the gaps), a row that does not parse at all has `{}`.
 */
export interface ThemeRow {
  id: string;
  name: string;
  system: boolean;
  tokens: Partial<TokenSet>;
}
