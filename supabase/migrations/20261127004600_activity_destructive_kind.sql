-- HYDLNK team access security re-review, finding 2 (M19-09, M19-10): takedowns and overwrites are
-- their own kind on the Members screen. Test: supabase/tests/database/238-activity-destructive-kind.
--
-- 20261126220700 listed the newest 25 activity rows of each kind (team, publish, content), but filed
-- trashing an entry, deleting a sub-page, purging a post, restoring a version or a revision and deleting
-- a category or tag under `content`. An editor can make 25 distinct content rows in a minute (add pages,
-- rename terms), which pushed a takedown of a live page off the screen.
--
-- They are now the kind `destructive`, with its own 25. Why a kind of their own and not `publish`:
--   * an editor may take things down (trash, delete, restore over the current draft) but may not
--     publish; filed under `publish`, an editor's 25 takedowns would push a publisher's publishes off;
--   * inside `destructive`, the only way to push a takedown off is 25 newer takedowns or overwrites,
--     each of which is itself damage the owner sees (and collapses per actor, entry and minute).
-- list_site_team partitions by team.activity_kind, so redefining it is the whole change; the body
-- below is 20261126220700's with the new branch.

create or replace function team.activity_kind(p_action text) returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_action like 'member%' or p_action = 'invite_revoked' then 'team'
    when p_action in ('site_published', 'design_published', 'page_published', 'post_published',
                      'post_unpublished', 'schedule_set', 'schedule_canceled') then 'publish'
    when p_action in ('entry_trashed', 'entry_deleted', 'entry_purged', 'version_restored',
                      'revision_restored', 'term_deleted') then 'destructive'
    else 'content'
  end;
$$;

revoke all on function team.activity_kind(text) from public, anon, authenticated, service_role;
