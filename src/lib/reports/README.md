# Reports (M5-05)

`public.reports` is server-only: RLS on, no policy, no grant for `anon` or `authenticated`. Every
read and write goes through the secret key (`createAdminSupabase`). Migration:
`supabase/migrations/20261003000001_blocklist_and_reports.sql`.

## Shape (decided by the M5-05 acceptance; it replaces the first sketch in the Wave D contract)

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `page_id` | uuid null | `references pages on delete set null`. A report outlives its page; the admin screen already shows `pageDeleted` for a null id |
| `page_handle` | text null | the handle at report time, so a report about a since-deleted page still names it |
| `reason` | text not null | `phishing` `malware` `impersonation` `spam` `illegal` `other` (UI labels: Phishing or scam, Malware, Impersonation, Spam, Illegal content, Something else) |
| `details` | text null | at most 1000 characters. Required for `reason = 'other'` by the form's Zod schema, not by the table (the admin specs insert such rows without it) |
| `reporter_email` | text null | optional, at most 254 characters |
| `reporter_hash` | text null | 64 lowercase hex characters: HMAC-SHA256 of the IP with a salt that rotates every UTC day. Never a raw IP (a check constraint refuses anything else). The form always sets it; it is null only for rows made some other way (the admin specs insert fixtures without it) |
| `status` | text not null | `open` (default) `dismissed` `actioned` |
| `created_at` | timestamptz | `now()` |
| `reviewed_at` | timestamptz null | set with `reviewed_by` when status leaves `open` (the admin actions already do this) |
| `reviewed_by` | uuid null | the admin's user id (a plain id, no foreign key: admins are named by `ADMIN_USER_IDS`) |
| `resolved_at` | timestamptz | generated, always equal to `reviewed_at`: the M5-05 column name, readable by anything that expects it |

Differences from the contract sketch: `page_id` is nullable with `on delete set null` (was `not null ... on delete
cascade`), and there are three new columns (`page_handle`, `reporter_hash`, `resolved_at`). `reviewed_at` and
`reviewed_by` are unchanged, so `src/lib/admin` needs no change.

## Submission path

`POST /report/submit` (a route handler on the marketing host, `src/app/(marketing)/report/submit/route.ts`)
validates with Zod, then calls two SQL functions with the secret key (both executable by `service_role` only):

1. `report_rate_limit_hit(keys, limit, window_seconds)`: a sliding-window counter over the small
   `report_attempts` table (hashed IP only, rows older than a day are pruned on every call). Every valid
   submission counts, including ones that turn out to be duplicates, so the 6th attempt in an hour is the one
   refused. Wave D's shared `rateLimit()` (M5-01) can replace this by wrapping the call in `limiter` of
   `src/lib/reports/submit.ts`.
2. `submit_report(...)`: one transaction that refuses a same-reporter, same-page repeat inside 24 hours
   (`duplicate`), caps a single page at 25 new reports an hour (`page_capped`, the answer is the same success
   message so nobody learns the cap), and otherwise inserts the row (`created`).

The salt is `HMAC-SHA256(VISITOR_HASH_SECRET, "YYYY-MM-DD")` (UTC); locally, where that variable may be unset,
the secret key stands in. The 24-hour and one-hour checks accept either today's or yesterday's hash, so a
reporter is not forgotten at UTC midnight.
