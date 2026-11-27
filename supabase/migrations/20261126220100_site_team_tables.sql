-- HYDLNK Wave F (M19-01): invites and the activity log of shared sites. Server only.
-- Test: supabase/tests/database/225-site-invites (and 224 for the cascades).
--
-- Both tables: RLS on, no policy, no privilege for anon, authenticated or service_role; written and
-- read only by the team functions (20261126200300, security definer). An invite stores the SHA-256 of
-- its token (256 random bits, never stored), lasts at most 7 days, ends once (accepted or revoked), and
-- a site has at most one pending invite per address.

create table team.site_invites (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.pages (id) on delete cascade,
  email text not null,
  token_hash text not null,
  role text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint site_invites_token_hash_key unique (token_hash),
  constraint site_invites_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint site_invites_email check (
    email = lower(email) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint site_invites_role check (role in ('editor', 'publisher')),
  constraint site_invites_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '7 days'
  ),
  constraint site_invites_one_end check (accepted_at is null or revoked_at is null),
  constraint site_invites_accepted_by check (accepted_by is null or accepted_at is not null)
);

-- One pending invite per site and address (an expired one is cleared by create_site_invite).
create unique index site_invites_pending_key on team.site_invites (site_id, email)
  where accepted_at is null and revoked_at is null;
create index site_invites_inviter_idx on team.site_invites (invited_by, created_at desc);

comment on table team.site_invites is
  'Invites to a site (Wave F). token_hash is the SHA-256 hex of the emailed token. Server only.';

revoke all on table team.site_invites from public, anon, authenticated, service_role;
alter table team.site_invites enable row level security;

create table team.site_activity (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.pages (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  role text not null,
  action text not null,
  entry_id uuid,
  at timestamptz not null default now(),
  constraint site_activity_role check (role in ('owner', 'editor', 'publisher')),
  constraint site_activity_action check (action in (
    'site_published', 'design_published', 'page_published', 'post_published', 'post_unpublished',
    'entry_trashed', 'entry_restored', 'entry_deleted', 'entry_purged', 'page_created', 'post_created',
    'revision_restored', 'version_restored', 'term_renamed', 'term_deleted',
    'schedule_set', 'schedule_canceled',
    'member_invited', 'invite_revoked', 'member_joined', 'member_removed', 'member_left',
    'member_role_changed'
  ))
);

create index site_activity_site_idx on team.site_activity (site_id, at desc);

comment on table team.site_activity is
  'What members and the owner did on a site (publish-class actions and team changes; autosaves are not recorded). Server only; purged after 180 days.';

revoke all on table team.site_activity from public, anon, authenticated, service_role;
alter table team.site_activity enable row level security;
