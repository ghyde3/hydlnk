-- M15-05 (1b1-09): run the content move. Every site's Home and sub-pages are copied into page
-- entries, then the page_versions are converted to system revisions. Copy-only and idempotent: the
-- site_pages rows and the blocks in pages.draft and pages.published stay as the frozen copies that
-- supabase/rollback/content-move-rollback.sql reverses. On a fresh local database this is a no-op,
-- because migrations run before the seed; seed.sql calls both functions again after its inserts.

select public.move_all_content();
select public.convert_all_versions();
