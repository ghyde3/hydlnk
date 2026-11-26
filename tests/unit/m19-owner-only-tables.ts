/**
 * The owner-only tables (Wave F, G20): their policies stay `owner_id = auth.uid()` and are never
 * shared with a site's members. The database holds the same list in `access.owner_only_tables()`
 * (migration 20261126220400_team_review_fixes.sql), which pgTAP 227 and 234 read;
 * tests/unit/m19-access-static.test.ts parses that function and fails when the two differ, and
 * guards later migrations with this list. One list, so the copies cannot disagree. Test data only:
 * no app code decides by it (the policies do), so it lives beside the tests.
 */
export const OWNER_ONLY_TABLES = [
  "accounts",
  "themes",
  "domains",
  "daily_stats",
  "daily_dim_stats",
  "daily_site_stats",
  "site_pages",
  "form_submissions",
] as const;
