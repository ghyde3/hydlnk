---
paths:
  - "supabase/**"
---

# Supabase migrations and RLS

The data model and access rules in `docs/PLAN.md` (Data model) are authoritative. RLS is the permission system: anything a policy allows, a user can do with the publishable key and curl.

- **One new migration per change.** Create it with `supabase migration new <slug>`. Never edit a migration that is already committed (a hook blocks it); fix forward with another migration. You may still edit a migration you created in this session and have not committed.
- **Every new table ships whole, in one change:** `enable row level security`, its policies, and a pgTAP test in `supabase/tests/database/` that proves allowed and denied cases (use the basejump `supabase_test_helpers`: `tests.create_supabase_user`, `tests.authenticate_as`, `tests.clear_authentication`).
- **Revoke the default grants.** Supabase grants new `public` tables and functions to `anon`, `authenticated` and `service_role`. Start with `revoke all on public.<table> from anon, authenticated;`, then grant the minimum. Use column-level grants where PLAN.md says so (for example `grant update (draft) on public.pages to authenticated`). For functions: `revoke execute ... from public, anon, authenticated` unless a role must call it.
- **Policies name their role** (`to authenticated` or `to anon`) and use `(select auth.uid())`. Nothing is public by default: no anon select on `pages`, no client access to `events` or `reserved_handles`.
- **Limits are enforced in the database** (pages, saved themes, domains, upload bytes) with triggers, not only in the UI or server code. `security definer` functions set `search_path = ''` and use schema-qualified names.
- **Server-only columns stay server-only:** `accounts.plan`, `stripe_customer_id`, `suspended_at`, `pages.published`, `pages.published_at`, `domains.status`, `domains.verified_at`. Add a test for each one that a user cannot change.
- **Reserved handles and system themes (Noir, Ivory, Smoke) live in migrations** so they reach production. `supabase/seed.sql` is local demo data only (tenant `mara`). Enable `pg_cron` in a migration.
- **Verify:** `pnpm db:reset && pnpm test:db && pnpm db:types`. Commit the regenerated `src/lib/supabase/database.types.ts` with the migration.
- **Production:** never push migrations or config from here. `supabase db push` and `supabase config push` run only through the `release` skill, with Gary's approval. Never `config push` while `config.toml` holds local auth values (`site_url` and redirect URLs on `app.localhost`): it would overwrite production's dashboard settings. Production auth changes only in the dashboard.
- See the `db-change` skill for the full steps.
