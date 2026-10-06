-- HYDLNK Wave D (M5-13, M5-14): the database side of the image pipeline.
--
--   * M5-14 cleanup queue. Drafts are saved from the browser with the user's own session (RLS), so
--     the database is the only server-side place that sees an image reference being dropped. Two
--     triggers record the dropped paths in `image_cleanup_queue`; the server's cleanup
--     (src/lib/media/cleanup.ts, called after a draft save, after Publish and before a quota
--     refusal) deletes a queued Storage object only when `media_paths_in_use` says nothing of the
--     owner's still names it. Nothing here deletes a Storage object: a SQL delete on storage.objects
--     would orphan the file. The queue only remembers what to look at.
--       - `pages` (UPDATE of draft or published, DELETE): a path that was in the page's draft or
--         published document and is in neither afterwards is queued, so a reference kept by the live
--         page is queued only by the Publish that drops it. A path that comes back (an Undo, the
--         same bytes uploaded again) leaves the queue.
--       - `themes` (UPDATE of tokens, DELETE): a bgImage URL that is dropped is queued.
--     Only paths inside the owner's own `{uid}/` folder are ever queued, so a draft that names
--     somebody else's object queues nothing.
--   * M5-13 upload rate limit: `image_upload_hits` and `media_upload_rate_hit`, a sliding window per
--     account (20 uploads per hour is the route's choice; the function takes the numbers).
--
-- Everything is server-only: RLS on, no client policy, default grants revoked, functions executable
-- by service_role only (the trigger functions run as their owner and are not callable at all).

-- ---------------------------------------------------------------------------
-- media_image_paths: every image reference inside a document
-- ---------------------------------------------------------------------------

-- `{uid}/{name}.{jpg|png|webp}` is IMAGE_PATH_PATTERN (src/lib/document/schema.ts). An image
-- reference holds it as `path`; a background holds it inside the object's public URL. Matching the
-- shape anywhere in the document's text finds both, and any field a later block type adds.
create function public.media_image_paths(p_doc jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct m[1]), '{}'::text[])
  from regexp_matches(
    coalesce(p_doc::text, ''),
    '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9-]{8,64}\.(?:jpg|png|webp))',
    'g'
  ) as m
$$;

revoke all on function public.media_image_paths(jsonb) from public, anon, authenticated;
grant execute on function public.media_image_paths(jsonb) to service_role;

comment on function public.media_image_paths(jsonb) is
  'Distinct {uid}/{name}.{jpg|png|webp} image paths found anywhere in a jsonb document. Server only.';

-- ---------------------------------------------------------------------------
-- image_cleanup_queue
-- ---------------------------------------------------------------------------

-- No foreign key on owner_id: deleting an account cascades to its pages, whose delete trigger
-- queues their images in the same statement, and a key to the account being deleted would fail it.
-- The account deletion removes the whole folder itself (src/lib/pages/delete-media.ts).
create table public.image_cleanup_queue (
  path text primary key,
  owner_id uuid not null,
  queued_at timestamptz not null default now(),
  constraint image_cleanup_queue_path_in_owner_folder
    check (left(path, 37) = owner_id::text || '/')
);

create index image_cleanup_queue_owner_idx on public.image_cleanup_queue (owner_id, queued_at);

alter table public.image_cleanup_queue enable row level security;
revoke all on public.image_cleanup_queue from public, anon, authenticated, service_role;
-- The cleanup reads a queue, takes paths off it and (the upload route) takes one path off it; the
-- triggers fill it as their owner. Inserting is for server-side tests and repairs.
grant select, insert, delete on public.image_cleanup_queue to service_role;

comment on table public.image_cleanup_queue is
  'Image paths dropped from a draft, a published document or a saved theme, waiting for the server cleanup to check that nothing references them and delete the Storage object. Server only.';

-- An account that is deleted takes its queue rows with it (there is no foreign key to cascade them,
-- see above). The account deletion removes the whole Storage folder itself.
create function public.media_queue_forget_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.image_cleanup_queue where owner_id = old.id;
  return null;
end;
$$;

revoke all on function public.media_queue_forget_account() from public, anon, authenticated;

create trigger accounts_forget_media_queue
  after delete on public.accounts
  for each row
  execute function public.media_queue_forget_account();

-- ---------------------------------------------------------------------------
-- Triggers: queue what a write dropped, un-queue what it brought back
-- ---------------------------------------------------------------------------

create function public.media_queue_page_refs()
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
    -- The whole page goes: everything its draft and published document named is dropped.
    dropped := public.media_image_paths(old.draft) || public.media_image_paths(old.published);
  else
    -- A save is mostly a draft change, so only the document that changed is scanned, and the other
    -- one is searched for the few paths that were dropped (a path that either document still names
    -- is not dropped from the page).
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
    insert into public.image_cleanup_queue (path, owner_id)
    select distinct p, old.owner_id
    from unnest(dropped) as p
    where left(p, 37) = old.owner_id::text || '/'
    on conflict (path) do update set queued_at = now();
  end if;
  if cardinality(added) > 0 then
    delete from public.image_cleanup_queue
    where owner_id = old.owner_id and path = any (added);
  end if;
  return null;
end;
$$;

revoke all on function public.media_queue_page_refs() from public, anon, authenticated;

create trigger pages_queue_dropped_media
  after update of draft, published on public.pages
  for each row
  when (old.draft is distinct from new.draft or old.published is distinct from new.published)
  execute function public.media_queue_page_refs();

create trigger pages_queue_deleted_media
  after delete on public.pages
  for each row
  execute function public.media_queue_page_refs();

create function public.media_queue_theme_refs()
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

  insert into public.image_cleanup_queue (path, owner_id)
  select distinct p, old.owner_id
  from unnest(before_refs) as p
  where left(p, 37) = old.owner_id::text || '/'
    and not (p = any (after_refs))
  on conflict (path) do update set queued_at = now();

  if tg_op = 'UPDATE' then
    delete from public.image_cleanup_queue
    where owner_id = new.owner_id and path = any (after_refs);
  end if;
  return null;
end;
$$;

revoke all on function public.media_queue_theme_refs() from public, anon, authenticated;

create trigger themes_queue_dropped_media
  after update of tokens on public.themes
  for each row
  when (old.tokens is distinct from new.tokens)
  execute function public.media_queue_theme_refs();

create trigger themes_queue_deleted_media
  after delete on public.themes
  for each row
  execute function public.media_queue_theme_refs();

-- ---------------------------------------------------------------------------
-- media_paths_in_use: which of these paths does the owner still reference?
-- ---------------------------------------------------------------------------

-- One statement, so one snapshot: every draft, every published document and every saved theme of
-- `p_uid` is looked at together. A path counts as used when its text appears anywhere in one of
-- them (an image reference's path, a background's public URL). Only the owner's own documents
-- count: another account naming this path keeps nothing alive, and cannot be harmed by it either.
create function public.media_paths_in_use(p_uid uuid, p_paths text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p), '{}'::text[])
  from unnest(p_paths) as p
  where exists (
      select 1
      from public.pages g
      where g.owner_id = p_uid
        and (strpos(g.draft::text, p) > 0 or strpos(coalesce(g.published::text, ''), p) > 0)
    )
    or exists (
      select 1
      from public.themes t
      where t.owner_id = p_uid
        and strpos(t.tokens::text, p) > 0
    )
$$;

revoke all on function public.media_paths_in_use(uuid, text[]) from public, anon, authenticated;
grant execute on function public.media_paths_in_use(uuid, text[]) to service_role;

comment on function public.media_paths_in_use(uuid, text[]) is
  'The subset of p_paths that a draft, a published document or a saved theme of p_uid still names. The cleanup deletes a queued object only when it is not in this set. Server only (service_role).';

-- ---------------------------------------------------------------------------
-- image_upload_hits: the per-account upload rate limit (M5-13)
-- ---------------------------------------------------------------------------

create table public.image_upload_hits (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.accounts (id) on delete cascade,
  hit_at timestamptz not null default now()
);

create index image_upload_hits_owner_idx on public.image_upload_hits (owner_id, hit_at);

alter table public.image_upload_hits enable row level security;
-- Only `media_upload_rate_hit` (security definer) touches it: no role needs a table privilege.
revoke all on public.image_upload_hits from public, anon, authenticated, service_role;

comment on table public.image_upload_hits is
  'One row per upload request inside the rate-limit window (older rows are pruned by media_upload_rate_hit). Server only.';

-- Counts one upload request of `p_uid` and says whether it may proceed. A sliding window: at most
-- `p_limit` requests in any `p_window_seconds`; a refused request is not counted, so the first
-- slot frees `retry_after` seconds after the oldest request in the window. An advisory lock per
-- account makes two simultaneous requests count one after the other.
create function public.media_upload_rate_hit(p_uid uuid, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  hits integer;
  oldest timestamptz;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'limit and window must be positive' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('media_upload_rate:' || p_uid::text, 0));

  delete from public.image_upload_hits h where h.owner_id = p_uid and h.hit_at < window_start;
  select count(*)::integer, min(h.hit_at) into hits, oldest
  from public.image_upload_hits h
  where h.owner_id = p_uid;

  if hits >= p_limit then
    allowed := false;
    retry_after := greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => p_window_seconds) - now())))::integer);
    return next;
    return;
  end if;

  insert into public.image_upload_hits (owner_id) values (p_uid);
  allowed := true;
  retry_after := 0;
  return next;
end;
$$;

revoke all on function public.media_upload_rate_hit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.media_upload_rate_hit(uuid, integer, integer) to service_role;

comment on function public.media_upload_rate_hit(uuid, integer, integer) is
  'Counts one upload request for p_uid in a sliding window; returns (allowed, retry_after seconds). Server only (service_role).';
