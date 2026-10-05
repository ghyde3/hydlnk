-- HYDLNK Wave M2 (M12-04): whole-site versions.
--
-- A published version now holds Home (`document`, with its `nav`) and every live sub-page of the site
-- at that publish (`sub_pages`: an array of {id, path, title, published}, ordered by path). The trigger
-- reads the sub-pages in the publishing transaction: publish_site writes the sub-pages first and the
-- pages row last, so their new `published` documents are visible to it. A sub-page deleted later stays
-- in the older versions (the column is a copy, with no foreign key). Existing rows get an empty array.
--
-- Retention: the newest `versions_kept` versions per site (as before), and further, oldest first, so a
-- site's versions never hold more than 32 MiB (33554432 bytes, measured as octet_length(x::text) of
-- `document` plus `sub_pages`, the way the other size checks measure). The newest version is never
-- pruned (numbers are never reused), so one version larger than the cap on its own is kept alone.
--
-- Access is unchanged: the owner select policy covers the new column, and no role writes the table.

alter table public.page_versions
  add column sub_pages jsonb not null default '[]'::jsonb;

alter table public.page_versions
  add constraint page_versions_sub_pages_is_array check (jsonb_typeof(sub_pages) = 'array');

comment on column public.page_versions.sub_pages is
  'The live sub-pages of the site at this publish: [{id, path, title, published}], ordered by path. Copies: a page deleted later stays here. Empty array for versions recorded before Wave M2 and for sites without sub-pages.';

create or replace function public.record_page_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_keep integer;
  v_newest_no integer;
  v_newest_doc jsonb;
  v_newest_subs jsonb;
  v_subs jsonb;
  v_next integer;
begin
  if new.published is null or new.published_at is not distinct from old.published_at then
    return null;
  end if;

  select a.plan into v_plan from public.accounts a where a.id = new.owner_id;
  if not found then
    return null;
  end if;

  select l.versions_kept into v_keep from public.plan_limits(v_plan) l;
  if v_keep is null or v_keep <= 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('page_versions:' || new.id::text, 0));

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'path', s.published ->> 'path',
               'title', s.published ->> 'title',
               'published', s.published
             )
             order by s.live_path, s.id
           ),
           '[]'::jsonb
         )
    into v_subs
    from public.site_pages s
    where s.page_id = new.id and s.published is not null;

  select v.version_no, v.document, v.sub_pages
    into v_newest_no, v_newest_doc, v_newest_subs
    from public.page_versions v
    where v.page_id = new.id
    order by v.version_no desc
    limit 1;

  -- jsonb equality ignores key order, so the same site republished adds nothing.
  if found and v_newest_doc = new.published and v_newest_subs = v_subs then
    return null;
  end if;

  v_next := coalesce(v_newest_no, 0) + 1;

  insert into public.page_versions (page_id, version_no, document, sub_pages, published_at)
  values (new.id, v_next, new.published, v_subs, new.published_at);

  -- Keep the newest `v_keep` versions. The newest one is never pruned, so numbers are not reused.
  delete from public.page_versions v
  where v.page_id = new.id
    and v.version_no <= v_next - v_keep;

  -- And at most 32 MiB in all: add sizes newest first and drop every older version past the cap.
  delete from public.page_versions v
  using (
    select
      t.id,
      sum(t.bytes) over (order by t.version_no desc) as running
    from (
      select
        x.id,
        x.version_no,
        octet_length(x.document::text)::bigint + octet_length(x.sub_pages::text)::bigint as bytes
      from public.page_versions x
      where x.page_id = new.id
    ) t
  ) sized
  where v.id = sized.id
    and sized.running > 33554432
    and v.version_no < v_next;

  return null;
end;
$$;

revoke all on function public.record_page_version() from public, anon, authenticated;

comment on function public.record_page_version() is
  'AFTER UPDATE trigger function of pages: records Home plus every live sub-page as the next page_versions row for a plan that keeps versions, then prunes to the newest versions_kept and to 32 MiB per site, oldest first. Not callable by any API role.';
