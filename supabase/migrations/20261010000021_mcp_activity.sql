-- HYDLNK Wave L (M10-05, M10-32): the activity log of the MCP connector, the fifth table of the OAuth
-- and MCP tables (the other four are in 20261010000010_oauth.sql).
--
--   mcp_activity   one row per tool call that passed the bearer check: who (the person and the
--                  app), which tool, which page, whether it worked and the error code when it did
--                  not. SERVER ONLY (RLS on, no policy, nothing for anon, authenticated or PUBLIC;
--                  service_role may read and insert, the nightly job deletes as the database owner).
--
-- NO CONTENT, by construction: there is no column for an argument, a result, a text, a URL, an image,
-- a preview link or an address, so nothing can be written there by mistake. `client_id` is plain text
-- with no foreign key, so a row outlives the client's cache row; `page_id` is set null when the page
-- is deleted; the person's rows go with the account. Rows older than 90 days are deleted every night
-- (MCP_ACTIVITY_RETENTION_DAYS in src/lib/mcp/constants.ts, which the privacy policy and /connect read).

create table public.mcp_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.accounts (id) on delete cascade,
  -- The client's id as text (an https URL or hlc_ plus 32 hex), kept even when the client row is gone.
  client_id text not null,
  -- The grant the token belonged to; the log outlives a grant that was removed.
  grant_id uuid references public.oauth_grants (id) on delete set null,
  -- The tool's name: snake_case, at most 40 characters.
  tool text not null,
  -- The page the call named, when the caller owned it. A refused call stores null.
  page_id uuid references public.pages (id) on delete set null,
  ok boolean not null,
  -- One of the pinned failure codes (invalid_input, not_found, rate_limited, ...). Null when ok.
  error_code text,
  at timestamptz not null default now(),
  constraint mcp_activity_client_id check (char_length(client_id) between 1 and 2048),
  constraint mcp_activity_tool check (tool ~ '^[a-z_]{1,40}$'),
  constraint mcp_activity_error_code check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  constraint mcp_activity_ok_has_no_error check (not ok or error_code is null)
);

create index mcp_activity_user_at_idx on public.mcp_activity (user_id, at desc);

comment on table public.mcp_activity is
  'One row per MCP tool call: person, app, tool, page, outcome. No arguments, results, text, URLs or addresses. Deleted after 90 days. Server only.';

alter table public.mcp_activity enable row level security;

revoke all on table public.mcp_activity from public, anon, authenticated, service_role;
grant select, insert on public.mcp_activity to service_role;

-- Every night the rows older than 90 days are deleted. Guarded like the other jobs.
do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'purge-mcp-activity',
      '40 0 * * *',
      $job$delete from public.mcp_activity where at < now() - interval '90 days'$job$
    );
  else
    raise warning 'pg_cron is not available: mcp_activity is NOT pruned on a schedule';
  end if;
end;
$cron$;
