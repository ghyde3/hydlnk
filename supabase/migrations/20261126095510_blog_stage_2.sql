-- HYDLNK Wave B (M16-01): the database additions of the blog (content model, stage 2).
--
--   * content_slug_redirects: the old slugs of a published entry. A republish that changes the live
--     slug records the old one against the entry; a slug that goes live again (the same entry or a
--     later one) deletes its row; the newest 200 per type are kept. Unpublish and trash record nothing.
--     Access: RLS on; an owner may SELECT rows of their own sites; service_role may SELECT (the public
--     lookup); nobody else has anything, and no role has a write grant (the trigger is the one writer).
--   * HL015: a type holds at most 500 terms (categories and tags together), on every plan.
--   * content_entries_live_order_idx: the archive order (newest first by first publish date).
--   * live_term_counts(site, type): a type's terms with their number of live entries, service_role only.
--
-- No change to publish_entry, plan_limits or the HL010 trigger: posts per plan are already enforced
-- (supabase/tests/database/218-posts-per-plan.test.sql pins it).

-- ---------------------------------------------------------------------------
-- content_slug_redirects
-- ---------------------------------------------------------------------------

create table public.content_slug_redirects (
  site_id uuid not null references public.pages (id) on delete cascade,
  type_id uuid not null references public.content_types (id) on delete cascade,
  from_slug text not null,
  entry_id uuid not null references public.content_entries (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (type_id, from_slug),
  constraint content_slug_redirects_from_slug_format check (
    from_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
  )
);

create index content_slug_redirects_site_id_idx on public.content_slug_redirects (site_id);
create index content_slug_redirects_entry_id_idx on public.content_slug_redirects (entry_id);

comment on table public.content_slug_redirects is
  'Old slugs of a published entry (301 to its current slug). Written only by the record_slug_redirect trigger; the newest 200 per type are kept. Owners and service_role read; nobody writes.';

create function public.enforce_slug_redirect_same_site() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type_site uuid;
  v_entry_site uuid;
  v_entry_type uuid;
begin
  select t.site_id into v_type_site from public.content_types t where t.id = new.type_id;
  select e.site_id, e.type_id into v_entry_site, v_entry_type
    from public.content_entries e where e.id = new.entry_id;
  if v_type_site is distinct from new.site_id
     or v_entry_site is distinct from new.site_id
     or v_entry_type is distinct from new.type_id then
    raise exception 'a slug redirect must belong to its type''s and its entry''s site' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_slug_redirect_same_site() from public, anon, authenticated;

create trigger enforce_same_site before insert or update on public.content_slug_redirects
  for each row execute function public.enforce_slug_redirect_same_site();

revoke all on table public.content_slug_redirects from anon, authenticated, service_role;
grant select on public.content_slug_redirects to authenticated;
grant select on public.content_slug_redirects to service_role;

alter table public.content_slug_redirects enable row level security;

create policy content_slug_redirects_select_own on public.content_slug_redirects
  for select to authenticated
  using (exists (select 1 from public.pages p
    where p.id = content_slug_redirects.site_id and p.owner_id = (select auth.uid())));

-- The one writer. Runs after the published copy of an entry changes (publish_entry, unpublish_entry,
-- trash_entry and the per-page publish functions all go through this column).
create function public.record_slug_redirect() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text := case when tg_op = 'UPDATE' then old.live_slug else null end;
begin
  -- Nothing live now (unpublish, trash) or the slug did not change: nothing to record or to free.
  if new.live_slug is null or new.live_slug is not distinct from v_old then
    return null;
  end if;

  -- The slug that just went live answers for itself: a redirect from it would shadow the entry.
  delete from public.content_slug_redirects r
    where r.type_id = new.type_id and r.from_slug = new.live_slug;

  -- A live slug was replaced: the old one now points at this entry. A slug the table cannot hold
  -- (one that was never the writer's) is skipped, so a publish is never refused here.
  if v_old is not null and v_old ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' then
    insert into public.content_slug_redirects (site_id, type_id, from_slug, entry_id, created_at)
      values (new.site_id, new.type_id, v_old, new.id, clock_timestamp())
      on conflict (type_id, from_slug) do update
        set entry_id = excluded.entry_id, site_id = excluded.site_id, created_at = excluded.created_at;

    delete from public.content_slug_redirects r
      where r.type_id = new.type_id
        and r.from_slug not in (
          select k.from_slug from public.content_slug_redirects k
          where k.type_id = new.type_id
          order by k.created_at desc, k.from_slug desc
          limit 200
        );
  end if;
  return null;
end;
$$;

revoke execute on function public.record_slug_redirect() from public, anon, authenticated;

create trigger record_slug_redirect after insert or update of published on public.content_entries
  for each row execute function public.record_slug_redirect();

-- ---------------------------------------------------------------------------
-- Archive order
-- ---------------------------------------------------------------------------

create index content_entries_live_order_idx
  on public.content_entries (site_id, type_id, first_published_at desc, id)
  where published is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- HL015: terms per type
-- ---------------------------------------------------------------------------

create function public.enforce_content_term_cap() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max constant integer := 500;
  v_count integer;
begin
  -- One writer per type at a time, so two inserts cannot both read 499.
  perform 1 from public.content_types t where t.id = new.type_id for no key update;
  select count(*) into v_count
    from public.content_terms c
    where c.type_id = new.type_id and c.id <> new.id;
  if v_count >= v_max then
    raise exception 'term limit reached: a type holds at most % categories and tags', v_max
      using errcode = 'HL015';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_content_term_cap() from public, anon, authenticated;

create trigger enforce_term_cap before insert or update of type_id on public.content_terms
  for each row execute function public.enforce_content_term_cap();

-- ---------------------------------------------------------------------------
-- live_term_counts
-- ---------------------------------------------------------------------------

create function public.live_term_counts(p_site uuid, p_type uuid)
returns table (id uuid, taxonomy text, slug text, name text, parent_id uuid, live_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.taxonomy, t.slug, t.name, t.parent_id,
    (select count(*)
       from public.content_entry_terms et
       join public.content_entries e on e.id = et.entry_id
       where et.term_id = t.id
         and e.site_id = t.site_id and e.type_id = t.type_id
         and e.published is not null and e.deleted_at is null)::integer as live_count
  from public.content_terms t
  where t.site_id = p_site and t.type_id = p_type
  order by t.taxonomy, t.name, t.id;
$$;

revoke all on function public.live_term_counts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_term_counts(uuid, uuid) to service_role;
