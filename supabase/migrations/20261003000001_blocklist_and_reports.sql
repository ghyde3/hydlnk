-- HYDLNK Wave D (M5-03, M5-05): the link blocklist and page reports.
--
--   * M5-03: `blocked_domains` (server-only) and a trigger on `pages` that refuses a draft holding a
--     link to a blocked site, whoever writes it. Clients save drafts straight to PostgREST under RLS,
--     so the save-time check has to live here. Publish runs the same SQL function again through
--     `public.blocked_links_in` (executable by service_role only).
--   * M5-05: `reports` (a visitor's report about a page), `report_attempts` (the flood counter for the
--     public report form) and the two functions the form's route handler calls with the secret key.
--
-- The save-time check here is a convenience (an early, specific error in the editor). It is NOT the
-- authority: Publish also checks the FINAL published form in application code with the platform's
-- own URL parser (src/lib/blocklist/published.ts), which is what a browser follows, so a spelling
-- this function reads differently from a browser (Unicode tables lag, odd whitespace) cannot publish.
--
-- Error code added to the HL series from the init migration:
--   HL005  a draft links to a blocked site (message `blocked_link`, DETAIL the offending hosts,
--          comma separated, HINT the ids of the blocks that hold them, comma separated). PostgREST
--          answers HTTP 400 with code HL005.
--
-- Everything below is server-only: no grant and no policy for anon or authenticated.

-- ---------------------------------------------------------------------------
-- M5-03: blocked_domains
-- ---------------------------------------------------------------------------

create table public.blocked_domains (
  domain text primary key,
  reason text,
  created_at timestamptz not null default now(),
  constraint blocked_domains_normalized check (
    char_length(domain) between 1 and 253
    and domain = lower(domain)
    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'
  )
);

comment on table public.blocked_domains is
  'Registrable domains no draft may link to (subdomains included). Lower case, no scheme, no trailing dot. Server only; later entries arrive through migrations.';

revoke all on table public.blocked_domains from anon, authenticated, service_role;
grant select, insert, update, delete on public.blocked_domains to service_role;
alter table public.blocked_domains enable row level security;

-- Starter list: well-known IP-logger and IP-grabber services, which have no use on a link page except
-- to unmask the people who open it. Deliberately short. Gary reviews and extends it before launch,
-- and later entries go in new migrations (db-change skill).
insert into public.blocked_domains (domain, reason) values
  ('grabify.link', 'ip-logger'),
  ('iplogger.org', 'ip-logger'),
  ('iplogger.com', 'ip-logger'),
  ('iplogger.ru', 'ip-logger'),
  ('2no.co', 'ip-logger'),
  ('yip.su', 'ip-logger'),
  ('blasze.com', 'ip-logger'),
  ('leancoding.co', 'ip-logger'),
  ('stopify.co', 'ip-logger'),
  ('freegiftcards.co', 'ip-logger'),
  ('joinmy.site', 'ip-logger'),
  ('curiouscat.club', 'ip-logger');

-- ---------------------------------------------------------------------------
-- M5-03: reading a host out of a URL the way a browser would
-- ---------------------------------------------------------------------------

-- Percent-decodes `%XX` sequences as UTF-8. Text that is not valid UTF-8 once decoded is returned as
-- it came (the caller then rejects the '%' that is left).
create function public.blocklist_pct_decode(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_result text;
begin
  select convert_from(
           coalesce(
             string_agg(
               case when t.m[1] is not null then decode(t.m[1], 'hex') else convert_to(t.m[2], 'UTF8') end,
               ''::bytea order by t.o
             ),
             ''::bytea
           ),
           'UTF8'
         )
    into v_result
    from regexp_matches(p_text, '%([0-9A-Fa-f]{2})|([^%]+|%)', 'g') with ordinality as t(m, o);
  return v_result;
exception when others then
  return p_text;
end;
$$;

-- The host of an http(s) URL as a browser's URL parser resolves it, lower case with no trailing dot,
-- or null when the text is not an http(s) URL or has no usable host. Follows the WHATWG rules that
-- matter for matching: tab, line feed and carriage return are dropped, leading and trailing spaces,
-- control characters and every character JavaScript's trim() strips (no-break space, U+1680,
-- U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF) are stripped, "https:host" and any run
-- of slashes or backslashes after the scheme are accepted, the authority ends at / \ ? or #,
-- everything up to the last "@" is credentials, the port starts at the first ":", the host is
-- percent-decoded, and the code points IDNA ignores (soft hyphen, U+034F, the Mongolian free variation
-- selectors, zero-width space, word joiner, invisible plus, variation selectors, FEFF) are removed
-- before full-width letters and ideographic full stops are folded. A bracketed IPv6 literal comes
-- back as "[...]" so the built-in rules can refuse it. Work is bounded: a URL over 2048 characters
-- (the longest Publish accepts) is skipped, and only the last 512 characters of a longer host are
-- read (a blocked domain is a suffix), so a hostile draft cannot make this expensive.
create function public.blocklist_url_host(p_url text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  s text;
  v_host text;
begin
  if p_url is null or char_length(p_url) > 2048 then
    return null;
  end if;
  s := regexp_replace(p_url, '[\t\n\r]', '', 'g');
  s := regexp_replace(
    s,
    '^[\x01-\x20\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\x01-\x20\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '',
    'g'
  );
  if s !~* '^https?:' then
    return null;
  end if;
  s := regexp_replace(s, '^https?:[/\\]*', '', 'i');
  v_host := substring(s from '^[^/\\?#]*');
  v_host := regexp_replace(v_host, '^.*@', '');

  if left(v_host, 1) = '[' then
    return lower(substring(v_host from '^\[[^\]]*\]?'));
  end if;

  v_host := substring(v_host from '^[^:]*');
  if char_length(v_host) > 512 then
    v_host := right(v_host, 512);
  end if;
  if position('%' in v_host) > 0 then
    v_host := public.blocklist_pct_decode(v_host);
  end if;
  v_host := regexp_replace(
    v_host,
    '[\u00ad\u034f\u180b-\u180d\u180f\u200b\u2060\u2064\ufe00-\ufe0f\ufeff\U000e0100-\U000e01ef]',
    '',
    'g'
  );
  v_host := normalize(v_host, NFKC);
  v_host := regexp_replace(v_host, '[\u3002\uff0e\uff61]', '.', 'g');
  v_host := lower(v_host);
  v_host := regexp_replace(v_host, '^\.+|\.+$', '', 'g');

  -- Forbidden host code points make the URL invalid: nothing a browser can open.
  if v_host = '' or v_host ~ '[\x01-\x20#%/:<>?@\[\\\]^|\x7f]' then
    return null;
  end if;
  return v_host;
end;
$$;

comment on function public.blocklist_url_host(text) is
  'Browser-style host of an http(s) URL (lower case, no trailing dot) or null. Used by blocked_links_in.';

-- ---------------------------------------------------------------------------
-- M5-03: the single check, used by the trigger below and by Publish
-- ---------------------------------------------------------------------------

-- Every blocked link in a draft: the URL of a link, card, embed or image block, and of each social
-- icon and grid cell. `reason` is blocked_domain (the host is a blocked_domains entry or a
-- subdomain of one), ip_literal (an IPv4 in any notation, or a bracketed IPv6), single_label (no
-- dot: localhost and the like) or unverifiable (a host that still holds non-ASCII characters after
-- normalisation: this function cannot punycode it, so it cannot say it is not blocked; the Publish
-- check in application code, which can, is the authority). Values that are not strings, and strings
-- that are not http(s) URLs, are skipped: a draft may hold anything, Publish rejects what is
-- invalid. Other fields (the theme's background image, block overrides, image references) are never
-- read. At most 600 URLs of a draft are read (a valid draft holds at most about 400) and the pages
-- trigger refuses a draft with more than 200 blocks, so the cost of one save is bounded.
create function public.blocked_links_in(p_draft jsonb)
returns table (block_id text, item_id text, field text, host text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with blocks as (
    select b.value as blk
    from jsonb_array_elements(
           case when jsonb_typeof(p_draft -> 'blocks') = 'array' then p_draft -> 'blocks' else '[]'::jsonb end
         ) as b(value)
    where jsonb_typeof(b.value) = 'object'
  ),
  candidates as (
    select blocks.blk ->> 'id' as bid, null::text as iid, blocks.blk -> 'url' as u from blocks
    union all
    select blocks.blk ->> 'id', i.value ->> 'id', i.value -> 'url'
    from blocks
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(blocks.blk -> 'icons') = 'array' then blocks.blk -> 'icons' else '[]'::jsonb end
    ) as i(value)
    where jsonb_typeof(i.value) = 'object'
    union all
    select blocks.blk ->> 'id', c.value ->> 'id', c.value -> 'url'
    from blocks
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(blocks.blk -> 'cells') = 'array' then blocks.blk -> 'cells' else '[]'::jsonb end
    ) as c(value)
    where jsonb_typeof(c.value) = 'object'
  ),
  hosts as (
    select cand.bid, cand.iid, public.blocklist_url_host(cand.u #>> '{}') as h
    from (
      select c.bid, c.iid, c.u from candidates c where jsonb_typeof(c.u) = 'string' limit 600
    ) cand
  ),
  judged as (
    select
      hs.bid, hs.iid, hs.h,
      case
        when left(hs.h, 1) = '[' or substring(hs.h from '[^.]*$') ~ '^([0-9]+|0[xX][0-9a-fA-F]*)$'
          then 'ip_literal'
        when position('.' in hs.h) = 0
          then 'single_label'
        when hs.h ~ '[^\x01-\x7f]'
          then 'unverifiable'
        when exists (
          select 1
          from public.blocked_domains d
          where hs.h = d.domain or right(hs.h, char_length(d.domain) + 1) = '.' || d.domain
        )
          then 'blocked_domain'
      end as why
    from hosts hs
    where hs.h is not null
  )
  select j.bid, j.iid, 'url'::text, j.h, j.why
  from judged j
  where j.why is not null
$$;

comment on function public.blocked_links_in(jsonb) is
  'The link blocklist check (M5-03): every blocked URL in a draft with the block and item that hold it. service_role only.';

create function public.enforce_link_blocklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text;
  v_blocks text;
begin
  -- The draft schema allows 50 blocks (Publish refuses a 51st with a friendly message, so a draft may
  -- briefly hold a few more) and the editor never sends many more; a direct write of thousands is
  -- refused here before anything is scanned (23514 reads as "too large" to the editor).
  if jsonb_typeof(new.draft -> 'blocks') = 'array' and jsonb_array_length(new.draft -> 'blocks') > 200 then
    raise exception 'too_many_blocks' using errcode = '23514';
  end if;
  select string_agg(distinct l.host, ', ' order by l.host),
         string_agg(distinct l.block_id, ',' order by l.block_id)
    into v_hosts, v_blocks
    from public.blocked_links_in(new.draft) l;
  if v_hosts is not null then
    raise exception 'blocked_link'
      using errcode = 'HL005', detail = v_hosts, hint = coalesce(v_blocks, '');
  end if;
  return new;
end;
$$;

create trigger enforce_link_blocklist before insert or update of draft on public.pages
  for each row execute function public.enforce_link_blocklist();

revoke all on function public.blocklist_pct_decode(text) from public, anon, authenticated;
revoke all on function public.blocklist_url_host(text) from public, anon, authenticated;
revoke all on function public.blocked_links_in(jsonb) from public, anon, authenticated;
revoke all on function public.enforce_link_blocklist() from public, anon, authenticated;
grant execute on function public.blocklist_pct_decode(text) to service_role;
grant execute on function public.blocklist_url_host(text) to service_role;
grant execute on function public.blocked_links_in(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- M5-05: reports
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  -- A report outlives its page: the admin screen shows a null page_id as a deleted page.
  page_id uuid references public.pages (id) on delete set null,
  page_handle text,
  -- The page's owner when the report was filed. A plain id, not a foreign key: it survives the
  -- page's deletion (and the owner's), so a report about a deleted page can still be tied to an
  -- account that is suspended or has since come back.
  owner_id uuid,
  reason text not null,
  details text,
  reporter_email text,
  -- HMAC-SHA256 of the reporter's IP with a salt that rotates every UTC day. Never a raw IP. Null only
  -- for a row that did not come from the public form (a fixture, a manual entry): the form always sets it.
  reporter_hash text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- The admin who resolved it. A plain id, not a foreign key: admins are named by ADMIN_USER_IDS.
  reviewed_by uuid,
  -- The M5-05 name for the same moment as reviewed_at (the admin actions write reviewed_at).
  resolved_at timestamptz generated always as (reviewed_at) stored,
  constraint reports_reason_check check (
    reason in ('phishing', 'malware', 'impersonation', 'illegal', 'spam', 'other')
  ),
  constraint reports_status_check check (status in ('open', 'dismissed', 'actioned')),
  -- "Something else" needs details: the form enforces that (Zod, src/lib/reports/schema.ts), not the table.
  constraint reports_details_length check (details is null or char_length(details) <= 1000),
  constraint reports_email_length check (reporter_email is null or char_length(reporter_email) <= 254),
  constraint reports_hash_format check (reporter_hash is null or reporter_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.reports is
  'Visitor reports about a page (M5-05). Server only: written by the report form, read and resolved by the admin area.';

create index reports_page_created_idx on public.reports (page_id, created_at desc);
create index reports_hash_page_created_idx on public.reports (reporter_hash, page_id, created_at desc);
create index reports_status_created_idx on public.reports (status, created_at desc);

revoke all on table public.reports from anon, authenticated, service_role;
grant select, insert, update, delete on public.reports to service_role;
alter table public.reports enable row level security;

-- ---------------------------------------------------------------------------
-- M5-05: the report form's flood counter
-- ---------------------------------------------------------------------------

create table public.report_attempts (
  id bigint generated always as identity primary key,
  -- The same daily-salted hash as reports.reporter_hash.
  bucket text not null,
  created_at timestamptz not null default now(),
  constraint report_attempts_bucket_format check (bucket ~ '^[0-9a-f]{64}$')
);

comment on table public.report_attempts is
  'One row per counted submission of the public report form, for the hourly per-IP limit. Pruned after a day. Server only.';

create index report_attempts_bucket_created_idx on public.report_attempts (bucket, created_at);
create index report_attempts_created_idx on public.report_attempts (created_at);

revoke all on table public.report_attempts from anon, authenticated, service_role;
grant select, insert, update, delete on public.report_attempts to service_role;
alter table public.report_attempts enable row level security;

-- Counts one submission against `p_limit` per `p_window_seconds`. `p_keys` holds today's hash first
-- and, optionally, the previous day's, so a reporter is not forgotten at UTC midnight; the attempt is
-- recorded under the first. Over the limit nothing is recorded (a persistent flood does not extend
-- its own ban) and `retry_after` is the seconds until the oldest counted attempt leaves the window.
-- Serialised per key, so concurrent submissions cannot slip past the limit together.
create function public.report_rate_limit_hit(p_keys text[], p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_oldest timestamptz;
  v_window interval;
begin
  if p_keys is null or cardinality(p_keys) = 0 or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;
  v_window := make_interval(secs => p_window_seconds);
  perform pg_advisory_xact_lock(hashtextextended('report_rate_limit:' || p_keys[1], 0));
  delete from public.report_attempts where created_at < now() - interval '1 day';
  select count(*), min(a.created_at)
    into v_count, v_oldest
    from public.report_attempts a
    where a.bucket = any (p_keys) and a.created_at > now() - v_window;
  if v_count >= p_limit then
    return jsonb_build_object(
      'allowed', false,
      'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())))::integer)
    );
  end if;
  insert into public.report_attempts (bucket) values (p_keys[1]);
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;

-- Files a report unless this reporter already reported this page in the last 24 hours (`duplicate`)
-- or the page already took `p_page_cap` new reports in the last hour (`page_capped`, a flood against
-- one page). Returns `created`, `duplicate` or `page_capped`. The reporter and page are locked for the
-- transaction, so two identical submissions at once file one report.
create function public.submit_report(
  p_page_id uuid,
  p_page_handle text,
  p_reason text,
  p_details text,
  p_email text,
  p_hashes text[],
  p_page_cap integer default 25
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_page_id is null or p_hashes is null or cardinality(p_hashes) = 0 then
    raise exception 'a page and a reporter hash are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('submit_report:' || p_hashes[1] || ':' || p_page_id::text, 0));
  if exists (
    select 1 from public.reports r
    where r.page_id = p_page_id
      and r.reporter_hash = any (p_hashes)
      and r.created_at > now() - interval '24 hours'
  ) then
    return 'duplicate';
  end if;
  if (
    select count(*) from public.reports r
    where r.page_id = p_page_id and r.created_at > now() - interval '1 hour'
  ) >= p_page_cap then
    return 'page_capped';
  end if;
  insert into public.reports (page_id, page_handle, owner_id, reason, details, reporter_email, reporter_hash)
  values (
    p_page_id,
    p_page_handle,
    (select p.owner_id from public.pages p where p.id = p_page_id),
    p_reason,
    p_details,
    p_email,
    p_hashes[1]
  );
  return 'created';
end;
$$;

revoke all on function public.report_rate_limit_hit(text[], integer, integer) from public, anon, authenticated;
revoke all on function public.submit_report(uuid, text, text, text, text, text[], integer) from public, anon, authenticated;
grant execute on function public.report_rate_limit_hit(text[], integer, integer) to service_role;
grant execute on function public.submit_report(uuid, text, text, text, text, text[], integer) to service_role;
