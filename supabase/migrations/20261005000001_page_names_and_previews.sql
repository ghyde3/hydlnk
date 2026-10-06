-- HYDLNK Wave F (M6-09, M6-13): page names and private preview links.
--
--   * `pages.name`: a private name for each page, editor metadata only. It is not part of the page
--     document (`draft`/`published`), so renaming never touches `draft.rev`, the publish status or
--     any cached page. The owner renames it with the publishable key (column grant below, governed
--     by the existing `pages_update_own` policy, which also refuses a suspended owner), so nothing in
--     server code runs for a rename. The check keeps the name plain: trimmed, 1 to 60 characters,
--     no control character and no bidi override or isolate character.
--   * `preview_links`: the share link of the editor (a private link to the unpublished draft). Server
--     only: RLS on, no policy, no client privilege. Only the SHA-256 of the token is stored (the link
--     itself is shown once), a link lives at most 7 days, can be turned off (`revoked_at`) and a page
--     can hold at most 5 active links (BEFORE INSERT trigger, error code HL006, message
--     `preview_link_limit`). A nightly job drops links that ended more than 30 days ago.
--
-- Error codes used by triggers (see the init migration): HL006 preview link limit reached for the page.

-- ---------------------------------------------------------------------------
-- M6-13: page names
-- ---------------------------------------------------------------------------

-- Every existing row gets 'Main page' (the default), so the headings of M2-03 and M5-15 still hold.
alter table public.pages add column name text not null default 'Main page';

alter table public.pages add constraint pages_name_format check (
  name = btrim(name)
  and char_length(name) between 1 and 60
  and name !~ '[[:cntrl:]]'
  -- C1 controls (U+0080 to U+009F), then the bidi overrides (U+202A to U+202E) and isolates (U+2066 to U+2069).
  and name !~ '[\u0080-\u009F\u202A-\u202E\u2066-\u2069]'
);

comment on column public.pages.name is
  'Private name of the page, shown in the editor, the page switcher, Settings and Domains. Not part of the page document and never published.';

-- Beside the existing `draft` grant: the owner (and only an active owner, see pages_update_own) renames.
grant update (name) on public.pages to authenticated;

-- ---------------------------------------------------------------------------
-- M6-09: preview links
-- ---------------------------------------------------------------------------

create table public.preview_links (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  -- SHA-256 of the 256-bit token, 64 lowercase hex characters. The token itself is never stored.
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  constraint preview_links_token_hash_key unique (token_hash),
  constraint preview_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint preview_links_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '7 days'
  )
);

create index preview_links_page_id_idx on public.preview_links (page_id);

comment on table public.preview_links is
  'Private share links to the saved draft of a page. Only the SHA-256 of the token is stored. At most 7 days, revocable, at most 5 active per page. Server only: no client access.';

alter table public.preview_links enable row level security;
-- RLS on and no policy at all: only the secret key (service_role, which bypasses RLS) reaches it, and
-- only through the grants below. anon and authenticated hold nothing.
revoke all on table public.preview_links from public, anon, authenticated, service_role;
grant select, insert, update on public.preview_links to service_role;

-- Active-link cap: at most 5 links per page that are neither revoked nor expired, by the database
-- clock, for every role (the secret key and postgres included). An advisory lock per page makes
-- simultaneous inserts count one after the other, so two inserts at 4 of 5 yield exactly one row.
-- A row that is already revoked or expired when it is inserted takes no slot.
create function public.enforce_preview_link_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
begin
  if new.revoked_at is not null or new.expires_at <= now() then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hydlnk.preview_links:' || new.page_id::text, 0));

  select count(*)::integer into v_active
  from public.preview_links l
  where l.page_id = new.page_id
    and l.revoked_at is null
    and l.expires_at > now();

  if v_active >= 5 then
    raise exception 'preview_link_limit' using errcode = 'HL006', detail = 'A page can have at most 5 active preview links.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_preview_link_limit() from public, anon, authenticated;

create trigger enforce_preview_link_limit before insert on public.preview_links
  for each row execute function public.enforce_preview_link_limit();

-- ---------------------------------------------------------------------------
-- Retention: a link that ended (expired or turned off) more than 30 days ago is deleted at 00:40 UTC,
-- after the rollup (00:10), the purge (00:30) and before the traffic flags (00:50). Guarded like the
-- other jobs; its own job name, so re-applying the migration replaces it. The command holds no secret.
-- ---------------------------------------------------------------------------

do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'purge-preview-links',
      '40 0 * * *',
      $job$delete from public.preview_links where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days'$job$
    );
  else
    raise warning 'pg_cron is not available: preview_links is NOT pruned on a schedule';
  end if;
end;
$cron$;
