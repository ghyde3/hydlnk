-- HYDLNK Wave N (admin), M13-09: the app announcement.
--
-- One short message at the top of the editor for every signed-in owner, between a start and an end.
-- Plain text up to 200 characters and at most one https link (the page escapes it; the table only holds
-- text). Windows never overlap (an exclusion constraint), so at most one row is active at a time.
--
-- Access: `authenticated` may read ONLY the active row (RLS: starts_at <= now() < ends_at) and only
-- the columns the editor needs (no created_by); `anon` reads nothing, so it never reaches a public page.
-- Only service_role writes, through the two functions below (or directly with the secret key).

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  link text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The admin (a plain auth user id; admins are ADMIN_USER_IDS).
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint announcements_message_check check (
    char_length(message) between 1 and 200 and message = btrim(message) and message !~ '[[:cntrl:]]'
  ),
  constraint announcements_link_check check (
    link is null or (char_length(link) <= 2048 and link ~ '^https://[^[:space:][:cntrl:]]+$')
  ),
  constraint announcements_window_check check (ends_at > starts_at),
  constraint announcements_one_at_a_time exclude using gist (tstzrange(starts_at, ends_at) with &&)
);

comment on table public.announcements is
  'The app announcement (M13-09): one message between starts_at and ends_at, at most one active at a time. Owners read the active row only; service_role writes.';

alter table public.announcements enable row level security;

revoke all on table public.announcements from public, anon, authenticated, service_role;
grant select (id, message, link, starts_at, ends_at) on public.announcements to authenticated;
grant select, insert, update, delete on public.announcements to service_role;

create policy announcements_select_active on public.announcements
  for select to authenticated
  using (starts_at <= now() and ends_at > now());

-- Sets the announcement: the message runs from `p_starts` (null or past = now) to `p_ends`. It replaces
-- whatever is active or scheduled: a row that started earlier ends at the new start, a row that starts at
-- or after it is removed. Returns the new row's id. Bad input raises (check_violation or 22023).
create function public.admin_set_announcement(
  p_message text,
  p_link text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_admin uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := greatest(coalesce(p_starts, now()), now());
  v_id uuid;
begin
  if p_admin is null then
    raise exception 'the admin id is required' using errcode = '22023';
  end if;
  if p_ends is null or p_ends <= v_start then
    raise exception 'the end must be after the start' using errcode = '22023';
  end if;

  delete from public.announcements a where a.starts_at >= v_start;
  update public.announcements a set ends_at = v_start where a.ends_at > v_start;

  insert into public.announcements (message, link, starts_at, ends_at, created_by)
  values (btrim(coalesce(p_message, '')), nullif(btrim(coalesce(p_link, '')), ''), v_start, p_ends, p_admin)
  returning id into v_id;
  return v_id;
end;
$$;

-- Ends the active announcement now and removes any scheduled one. Returns how many rows it touched.
create function public.admin_clear_announcement()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_ended integer;
begin
  delete from public.announcements a where a.starts_at >= now();
  get diagnostics v_deleted = row_count;
  update public.announcements a set ends_at = now() where a.ends_at > now();
  get diagnostics v_ended = row_count;
  return v_deleted + v_ended;
end;
$$;

revoke all on function public.admin_set_announcement(text, text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.admin_clear_announcement() from public, anon, authenticated;
grant execute on function public.admin_set_announcement(text, text, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.admin_clear_announcement() to service_role;
