-- M15-02 (slice 4): media_paths_in_use also scans the content tables.
--
-- An image named only by an entry's draft or published copy, or by a revision snapshot, is still in
-- use, so the cleanup (src/lib/media/cleanup.ts) must keep its Storage object. Same signature as the
-- version in 20261011000001_site_pages.sql, so create or replace.

create or replace function public.media_paths_in_use(p_uid uuid, p_paths text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  -- Each document is cast to text once (the cast, not the substring test, is the expensive part), then
  -- every path is tested against that one copy.
  with docs as materialized (
    select g.draft::text as t from public.pages g where g.owner_id = p_uid
    union all
    select g.published::text from public.pages g where g.owner_id = p_uid and g.published is not null
    union all
    select s.draft::text
      from public.site_pages s join public.pages g on g.id = s.page_id
      where g.owner_id = p_uid
    union all
    select s.published::text
      from public.site_pages s join public.pages g on g.id = s.page_id
      where g.owner_id = p_uid and s.published is not null
    union all
    select e.draft::text
      from public.content_entries e join public.pages g on g.id = e.site_id
      where g.owner_id = p_uid
    union all
    select e.published::text
      from public.content_entries e join public.pages g on g.id = e.site_id
      where g.owner_id = p_uid and e.published is not null
    union all
    select r.snapshot::text
      from public.content_entry_revisions r join public.pages g on g.id = r.site_id
      where g.owner_id = p_uid
    union all
    select th.tokens::text from public.themes th where th.owner_id = p_uid
  )
  select coalesce(array_agg(p), '{}'::text[])
  from unnest(p_paths) as p
  where exists (select 1 from docs d where strpos(d.t, p) > 0)
$$;

comment on function public.media_paths_in_use(uuid, text[]) is
  'The subset of p_paths that a draft, a published document (Home, sub-page or content entry), a revision snapshot or a saved theme of p_uid still names. The cleanup deletes a queued object only when it is not in this set. Server only (service_role).';
