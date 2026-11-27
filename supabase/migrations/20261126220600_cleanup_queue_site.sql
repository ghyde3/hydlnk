-- HYDLNK team access attack pass, finding 1 (M19-05, M19-06): a member's cleanup call works only the
-- rows of the site it names. Test: supabase/tests/database/236-cleanup-queue-site.
--
-- POST /api/media/cleanup with `x-hl-site` worked off the site OWNER's whole queue, so an editor of
-- site S could delete an image the owner had just removed on another site S2, before the owner's Undo
-- (the drop is due at once). Queue rows now carry the site whose write queued them (`site_id`, filled
-- at queue time by every queueing trigger and by queue_new_upload); the server lets a member's call
-- see only rows of the site it names that are older than the editor's Undo window
-- (src/lib/media/cleanup-admin.ts). Rows with no site (a saved theme's, and rows queued before this
-- migration) are drained only by the owner's own calls, which keep working the whole queue.
--
-- No foreign key: a site's BEFORE DELETE triggers queue its images with the site's id while the row
-- is going, and a deleted site's id matches no site a member can name.

alter table public.image_cleanup_queue add column site_id uuid;

create index image_cleanup_queue_site_idx on public.image_cleanup_queue (site_id, queued_at)
  where site_id is not null;

comment on column public.image_cleanup_queue.site_id is
  'The site whose write queued the path (null: a saved theme, or queued before 20261126220600). A member''s cleanup call sees only its site''s rows; the owner''s sees all.';

-- The one insert every queueing trigger makes: paths of the owner's folder only (the table's check
-- says so too), queued now for `p_site`. A path queued again moves to the back and takes the newer
-- site (the write that dropped it last).
create function public.media_queue_paths(p_owner uuid, p_site uuid, p_paths text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.image_cleanup_queue (path, owner_id, site_id)
  select distinct p, p_owner, p_site
    from unnest(p_paths) as p
   where left(p, 37) = p_owner::text || '/'
  on conflict (path) do update set queued_at = now(), site_id = excluded.site_id;
$$;

revoke all on function public.media_queue_paths(uuid, uuid, text[]) from public, anon, authenticated, service_role;

-- The new upload (20261126220500) with its site. The three-argument form stays for callers that
-- have none and queues with no site.
create function public.queue_new_upload(p_owner uuid, p_path text, p_grace_seconds integer, p_site uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_grace_seconds is null or p_grace_seconds < 0 then
    raise exception 'invalid grace' using errcode = '22023';
  end if;
  insert into public.image_cleanup_queue (path, owner_id, queued_at, site_id)
    values (p_path, p_owner, now() + make_interval(secs => p_grace_seconds), p_site)
  on conflict (path) do update
    set queued_at = greatest(public.image_cleanup_queue.queued_at, excluded.queued_at),
        site_id = coalesce(excluded.site_id, public.image_cleanup_queue.site_id);
end;
$$;

revoke all on function public.queue_new_upload(uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.queue_new_upload(uuid, text, integer, uuid) to service_role;

create or replace function public.queue_new_upload(p_owner uuid, p_path text, p_grace_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.queue_new_upload(p_owner, p_path, p_grace_seconds, null::uuid);
end;
$$;

-- The queueing triggers, as they were, with the site passed to media_queue_paths.

create or replace function public.media_queue_page_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dropped text[] := '{}';
  added text[] := '{}';
  refs_old text[];
  refs_new text[];
  other_text text;
begin
  if tg_op = 'DELETE' then
    dropped := public.media_image_paths(old.draft) || public.media_image_paths(old.published);
  else
    if new.draft is distinct from old.draft then
      refs_old := public.media_image_paths(old.draft);
      refs_new := public.media_image_paths(new.draft);
      other_text := coalesce(new.published::text, '');
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
    if new.published is distinct from old.published then
      refs_old := public.media_image_paths(old.published);
      refs_new := public.media_image_paths(new.published);
      other_text := new.draft::text;
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
  end if;

  if cardinality(dropped) > 0 then
    perform public.media_queue_paths(old.owner_id, old.id, dropped);
  end if;
  if cardinality(added) > 0 then
    delete from public.image_cleanup_queue
    where owner_id = old.owner_id and path = any (added);
  end if;
  return null;
end;
$$;

create or replace function public.media_queue_theme_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_refs text[];
  after_refs text[] := '{}';
begin
  if old.owner_id is null then
    return null; -- system themes hold no uploads
  end if;
  before_refs := public.media_image_paths(old.tokens);
  if tg_op = 'UPDATE' then
    after_refs := public.media_image_paths(new.tokens);
  end if;

  -- A saved theme belongs to the account, not to a site: its rows carry no site (owner only).
  perform public.media_queue_paths(old.owner_id, null,
    coalesce((select array_agg(p) from unnest(before_refs) as p where not (p = any (after_refs))), '{}'));

  if tg_op = 'UPDATE' then
    delete from public.image_cleanup_queue
    where owner_id = new.owner_id and path = any (after_refs);
  end if;
  return null;
end;
$$;

create or replace function public.media_queue_site_page_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  dropped text[] := '{}';
  added text[] := '{}';
  refs_old text[];
  refs_new text[];
  other_text text;
begin
  select p.owner_id into v_owner from public.pages p where p.id = old.page_id;
  if v_owner is null then
    return null;
  end if;

  if tg_op = 'DELETE' then
    dropped := public.media_image_paths(old.draft) || public.media_image_paths(old.published);
  else
    if new.draft is distinct from old.draft then
      refs_old := public.media_image_paths(old.draft);
      refs_new := public.media_image_paths(new.draft);
      other_text := coalesce(new.published::text, '');
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
    if new.published is distinct from old.published then
      refs_old := public.media_image_paths(old.published);
      refs_new := public.media_image_paths(new.published);
      other_text := new.draft::text;
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
  end if;

  if cardinality(dropped) > 0 then
    perform public.media_queue_paths(v_owner, old.page_id, dropped);
  end if;
  if cardinality(added) > 0 then
    delete from public.image_cleanup_queue
    where owner_id = v_owner and path = any (added);
  end if;
  return null;
end;
$$;

create or replace function public.media_queue_site_refs_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The first BEFORE DELETE trigger on pages (names sort alphabetically): lock the site's sub-page
  -- rows now, in id order (see 20261011000001_site_pages.sql for the deadlock this avoids).
  perform 1 from public.site_pages where page_id = old.id order by id for update;

  perform public.media_queue_paths(old.owner_id, old.id, coalesce((
    select array_agg(p)
      from public.site_pages s
     cross join lateral unnest(
       public.media_image_paths(s.draft) || public.media_image_paths(s.published)
     ) as p
     where s.page_id = old.id), '{}'));
  return old;
end;
$$;

create or replace function public.media_queue_content_entry_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site uuid := coalesce(new.site_id, old.site_id);
  v_owner uuid;
  dropped text[] := '{}';
  added text[] := '{}';
  refs_old text[];
  refs_new text[];
  other_text text;
begin
  select p.owner_id into v_owner from public.pages p where p.id = v_site;
  if v_owner is null then
    return null; -- a cascade from a deleted site: the BEFORE DELETE trigger on pages queued them
  end if;

  if tg_op = 'INSERT' then
    added := public.media_image_paths(new.draft) || public.media_image_paths(new.published);
  elsif tg_op = 'DELETE' then
    dropped := public.media_image_paths(old.draft) || public.media_image_paths(old.published);
  else
    if new.draft is distinct from old.draft then
      refs_old := public.media_image_paths(old.draft);
      refs_new := public.media_image_paths(new.draft);
      other_text := coalesce(new.published::text, '');
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
    if new.published is distinct from old.published then
      refs_old := public.media_image_paths(old.published);
      refs_new := public.media_image_paths(new.published);
      other_text := new.draft::text;
      dropped := dropped || coalesce((
        select array_agg(p) from unnest(refs_old) as p
        where not (p = any (refs_new)) and strpos(other_text, p) = 0
      ), '{}');
      added := added || coalesce((
        select array_agg(p) from unnest(refs_new) as p where not (p = any (refs_old))
      ), '{}');
    end if;
  end if;

  if cardinality(dropped) > 0 then
    perform public.media_queue_paths(v_owner, v_site, dropped);
  end if;
  if cardinality(added) > 0 then
    delete from public.image_cleanup_queue
    where owner_id = v_owner and path = any (added);
  end if;
  return null;
end;
$$;

create or replace function public.media_queue_content_revision_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select p.owner_id into v_owner from public.pages p where p.id = old.site_id;
  if v_owner is null then
    return null;
  end if;
  perform public.media_queue_paths(v_owner, old.site_id, public.media_image_paths(old.snapshot));
  return null;
end;
$$;

create or replace function public.media_queue_content_on_page_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.content_entries where site_id = old.id order by id for update;

  perform public.media_queue_paths(old.owner_id, old.id, coalesce((
    select array_agg(q.p)
      from (
        select unnest(public.media_image_paths(e.draft) || public.media_image_paths(e.published)) as p
          from public.content_entries e where e.site_id = old.id
        union all
        select unnest(public.media_image_paths(r.snapshot))
          from public.content_entry_revisions r where r.site_id = old.id
      ) q), '{}'));
  return old;
end;
$$;
