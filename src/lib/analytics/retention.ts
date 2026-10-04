/**
 * How many UTC days raw analytics events (one row per view or click) are kept before the nightly
 * purge deletes them (M8-12, was 90). The rollups made from them (`daily_stats`, `daily_dim_stats`)
 * are never deleted, so the dashboard ranges (7, 30, 90 days and a year) and the Free plan's 30-day
 * window read the same numbers either way.
 *
 * This is the number the marketing and privacy copy says. The database function that does the
 * deleting is `public.purge_old_events()` (supabase/migrations/20261008000001_events_60_days.sql
 * and any later migration that redefines it): tests/unit/m8-levers-retention.test.ts reads the
 * newest definition and fails when its day count differs from this constant, so the text and the
 * SQL cannot drift. Dependency free on purpose: marketing pages import it.
 */
export const RAW_EVENT_RETENTION_DAYS = 60;
