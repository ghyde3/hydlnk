---
name: db-change
description: "Change the local database schema safely: a new migration with RLS, policies, revoked default grants, limit triggers and a pgTAP policy test in the same change, then reset, test and regenerate types. Never edit a committed migration."
---

# Database change

Read `.claude/rules/supabase-migrations.md` and the Data model section of `docs/PLAN.md` first. RLS is the permission system: assume every policy is reachable with the publishable key and curl.

1. **New migration.** `supabase migration new <slug>`. Never edit a migration that git already tracks (a hook blocks it); to change one, add another.
2. **Write the SQL.** For each new table: `create table`, `alter table ... enable row level security`, `revoke all on ... from anon, authenticated`, then only the grants and policies the access rules need (column-level grants where PLAN.md limits writes, for example `pages.draft`). Policies name their role and use `(select auth.uid())`. Plan limits go in triggers (`security definer`, `set search_path = ''`). Revoke `execute` on new functions from `public, anon, authenticated` unless a client must call them. Reserved handles and system themes belong in migrations, not `seed.sql`.
3. **Policy test, same change.** Add or extend a pgTAP file under `supabase/tests/database/` using the basejump `supabase_test_helpers`. Prove the allowed path and every denied path: another tenant, anon, writing server-only columns, going past a limit, no client access to server-only tables.
4. **Run it.** `pnpm db:reset && pnpm test:db && pnpm db:types`. All green. If `supabase start` is not running, run `./scripts/init.sh` first. Never `supabase db reset --linked`.
5. **Update the app.** Fix code and unit tests broken by the regenerated `src/lib/supabase/database.types.ts`; commit it with the migration. If the change adds seed data for local demos, put it in `supabase/seed.sql`.
6. **Review.** Run the `security-reviewer` agent on the diff. Then `pnpm verify`.
7. **Production.** Not from here. The migration reaches production only through the `release` skill.
