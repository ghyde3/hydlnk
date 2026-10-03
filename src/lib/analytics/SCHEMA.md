# Analytics storage: final shapes (Wave E, analytics-db)

Owner: analytics-db. Migrations `supabase/migrations/20261004000002_analytics.sql` (rollup, retention,
plan gating) and `20261004000004_traffic_flags.sql` (high-traffic flag). Everything is UTC.

## Retention: the 90 days is raw events only

| Data | Kept | Read by |
|---|---|---|
| `events` (raw, one row per view or click) | **90 days** (UTC day -90 stays, day -91 goes) | today's numbers; any day not yet rolled up |
| `daily_stats`, `daily_dim_stats` (nightly rollups) | **forever, never deleted** (only cascade with the page) | every completed day |

Pro and Studio get a 1-year range (and more) because that range reads the rollups, not the raw rows. The purge
rolls a day up before it deletes it, so nothing is lost when the raw rows go. Free sees the last 30 UTC days.

## Tables

### `events` (unchanged, server only)
`id, page_id, block_id ('' for views), type 'view'|'click', ts, referrer, device, country, visitor_hash`.
Inserted by the ingest code with the secret key. Ingest contract: `device` in `mobile|tablet|desktop` (or null),
`country` ISO 3166-1 alpha-2 (or null), `referrer` hostname only, lowercased (or null for direct).

### `daily_stats` (shape unchanged, semantics tightened)
`(page_id, block_id, day, views, clicks, uniques)`, primary key `(page_id, block_id, day)`.

- **Page-level row: `block_id = ''`** (the empty string, NOT null: it is part of the primary key). Some acceptance
  text says "block_id null"; it means this row. Filter with `block_id = ''`, never `is null`.
  - `views` = view events that day, `clicks` = **all** click events that day (sum of the page's block rows),
    `uniques` = distinct `visitor_hash` among **views**.
- **Block row: `block_id = <block id>`**, one per clicked block: `views = 0`, `clicks` = clicks on that block,
  `uniques` = distinct visitors that clicked it. Block rows keep their block id after the block leaves the
  published document (they are keyed by the id stored on the event).
- Visitor hashes rotate daily, so `uniques` are per day; a range total is the sum of daily uniques.

### `daily_dim_stats` (new)
`(page_id uuid references pages on delete cascade, day date, dim text, value text, views integer, clicks integer)`,
primary key `(page_id, day, dim, value)`; `dim` in `'referrer' | 'device' | 'country'`; `value` 1 to 255 chars;
counts >= 0. `views` counts view events with that value, `clicks` counts click events with that value (a share of
views is `views / sum(views)` per page, dim and range).

Normalisation (one rule per dim, applied in the rollup):

| dim | value |
|---|---|
| `referrer` | `lower(btrim(referrer))`; null or empty becomes **`direct`**. Per page and day only the **top 50** values (most views, then most clicks, then alphabetical) keep their own row; the rest are summed into **`other`**. |
| `device` | `mobile`, `tablet` or `desktop`; null, empty or anything else becomes **`unknown`**. |
| `country` | upper-case ISO alpha-2 (`US`); null, empty or anything else becomes **`unknown`**. |

A page with no events on a day gets no rows for that day (no zero rows).

## Functions (all `security definer`, `search_path = ''`, `execute` revoked from public/anon/authenticated, granted to `service_role`)

| Function | Does | Returns |
|---|---|---|
| `rollup_daily_stats(p_day date)` | Recomputes one UTC day for every page that has events that day: deletes that page's rows for the day (both tables) and inserts them again. Idempotent. A page with no events that day is left untouched, so re-running a day whose raw rows were already purged destroys nothing. | number of `daily_stats` rows written |
| `rollup_recent_days(n integer)` | Rolls up the last `n` completed UTC days (today excluded), oldest first. `n` must be 1 to 400. | total `daily_stats` rows written |
| `purge_old_events()` | Rolls up every UTC day older than 90 days that still has raw events, then deletes those events, in one transaction. | number of events deleted |
| `run_nightly_maintenance()` | Kept for compatibility: `rollup_recent_days(3)` then `purge_old_events()`. | void |
| `flag_high_traffic_pages(threshold integer default 100000)` | See "High-traffic flag". | number of flags created |
| `admin_traffic_flags(p_reviewed boolean, p_limit integer, p_offset integer)` | `/admin/traffic` list: flag + handle + owner email + plan. | rows |

## Schedule (pg_cron, UTC)

| Job | Schedule | Command |
|---|---|---|
| `rollup-daily-stats` | `10 0 * * *` | `select public.rollup_recent_days(3)` (a missed night heals itself) |
| `purge-old-events` | `30 0 * * *` | `select public.purge_old_events()` |
| `flag-high-traffic` | `50 0 * * *` | `select public.flag_high_traffic_pages()` (after the rollup, with margin) |

The old `hydlnk-nightly-maintenance` job (03:10) is unscheduled by the migration. Until 00:10 UTC yesterday may
not be rolled up yet: a reader that wants exact numbers can fall back to raw events for any completed day inside
the last 90 days that has no page-level `daily_stats` row.

## Row level security (reads only; nobody writes these tables through the API)

| Table | Free owner | Pro / Studio owner | anon | other users |
|---|---|---|---|---|
| `daily_stats` | only rows with `day >= utc_today - 29` (the last 30 UTC days, today included) | everything | no privilege | own pages only |
| `daily_dim_stats` | nothing | everything | no privilege | own pages only |
| `traffic_flags` | no access | no access | no access | no access (server only) |

The gate reads `accounts.plan` at query time, so a plan flip through the Stripe webhook takes effect on the next
query. The Free window mirrors `plan_limits('free').analytics_history_days` (30); a pgTAP test pins the two together.
The secret key (the Next.js server) bypasses RLS: dashboard code must apply the plan rule itself (M4-30).

## High-traffic flag (M5-10)

`traffic_flags(id uuid, page_id references pages on delete cascade, window_start date, window_end date,
views integer, flagged_at timestamptz default now(), reviewed_at timestamptz null)`. RLS on, no policies, no client
grants; `service_role` may `select` and `update (reviewed_at)`.

`flag_high_traffic_pages(threshold)` sums page-level views (`block_id = ''`) over the 30 UTC days ending yesterday
for pages whose owner is on `free`, and inserts one flag when the sum is greater than the threshold
(`window_start` = today - 30, `window_end` = yesterday, `views` = the sum). It creates nothing while the page has an
unreviewed flag, nor within 30 days after `reviewed_at`. A partial unique index allows at most one unreviewed flag per
page. Flagged pages keep serving; nothing touches `pages`.
