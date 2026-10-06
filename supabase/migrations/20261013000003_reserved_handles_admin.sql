-- HYDLNK Wave N (admin), M13-08: reserved handles an admin can manage.
--
-- `reserved_handles` gains reason, added_by, kind and created_at:
--   kind 'system'  platform names (app, www, api, admin and the rest of the original list): locked,
--                  the admin screen cannot remove them
--   kind 'admin'   everything an admin adds at /admin/reserved and the curated pre-fill below
--                  (removable on the screen)
-- Existing rows become 'system'. A reservation only stops NEW claims: the pages trigger
-- enforce_handle_not_reserved (init migration, on insert and on a change of handle) refuses a reserved
-- handle with HL004, and nothing here touches a page that already holds one.
--
-- The table stays server only (RLS on, no policy, service_role SELECT only): the three functions
-- below are security definer and service_role only, so a handle is added or removed only by them.

alter table public.reserved_handles
  add column reason text,
  add column added_by uuid,
  add column kind text not null default 'system',
  add column created_at timestamptz not null default now(),
  add constraint reserved_handles_kind_check check (kind in ('system', 'admin')),
  add constraint reserved_handles_reason_length check (reason is null or char_length(reason) <= 200);

comment on column public.reserved_handles.reason is 'Why it is reserved (at most 200 characters). Null for the original platform list.';
comment on column public.reserved_handles.added_by is 'The admin who added it (a plain auth user id, no foreign key). Null for migrations.';
comment on column public.reserved_handles.kind is 'system = platform names, locked; admin = added by an admin or the curated pre-fill, removable.';

-- ---------------------------------------------------------------------------
-- BEGIN CURATED PRE-FILL (Gary, 2026-10-06): well-known brands, platforms and impersonation-prone
-- words. One block, by category. Every entry is lower case, valid under the handle rule
-- (3 to 30 characters, a-z 0-9 and hyphen, no hyphen at either end) and absent from the original
-- list. kind 'admin', so each can be removed on /admin/reserved. Existing users who hold one keep it.
--
-- Social and creator platforms: 52
insert into public.reserved_handles (handle, reason, kind)
select h, 'Social and creator platforms', 'admin'
from unnest(array[
  'reddit', 'pinterest', 'tumblr', 'twitch', 'kick', 'patreon', 'onlyfans', 'fansly', 'substack',
  'medium', 'threads', 'bluesky', 'mastodon', 'wechat', 'weibo', 'viber', 'signal', 'clubhouse',
  'vimeo', 'soundcloud', 'bandcamp', 'deezer', 'tidal', 'vsco', 'behance', 'dribbble', 'flickr',
  'quora', 'tinder', 'bumble', 'hinge', 'grindr', 'wordpress', 'wix', 'squarespace', 'kofi', 'ko-fi',
  'buymeacoffee', 'gumroad', 'cameo', 'twitter-x', 'x-com', 'xcom', 'kakaotalk', 'snap', 'messenger',
  'skype', 'letterboxd', 'strava', 'yelp', 'tripadvisor', 'imgur'
]) as h
on conflict (handle) do nothing;

--
-- Big tech and well-known consumer brands: 74
insert into public.reserved_handles (handle, reason, kind)
select h, 'Big tech and well-known consumer brands', 'admin'
from unnest(array[
  'meta', 'openai', 'anthropic', 'chatgpt', 'claude', 'gemini', 'copilot', 'siri', 'alexa', 'tesla',
  'nike', 'adidas', 'samsung', 'sony', 'nintendo', 'playstation', 'xbox', 'disney', 'marvel', 'max',
  'spotify-official', 'cocacola', 'coca-cola', 'pepsi', 'mcdonalds', 'burgerking', 'starbucks',
  'ikea', 'walmart', 'target', 'ebay', 'etsy', 'aliexpress', 'alibaba', 'uber', 'lyft', 'airbnb',
  'booking', 'expedia', 'doordash', 'nvidia', 'intel', 'amd', 'adobe', 'oracle', 'ibm', 'cisco',
  'salesforce', 'slack', 'dropbox', 'cloudflare', 'twilio', 'atlassian', 'notion', 'figma', 'canva',
  'zoom', 'android', 'ios', 'windows', 'linux', 'chrome', 'firefox', 'safari', 'gmail', 'outlook',
  'icloud', 'youtube-music', 'appstore', 'playstore', 'mercedes', 'apple-support', 'google-support',
  'amazon-prime'
]) as h
on conflict (handle) do nothing;

--
-- Payments and banks: 49
insert into public.reserved_handles (handle, reason, kind)
select h, 'Payments and banks', 'admin'
from unnest(array[
  'venmo', 'cashapp', 'cash-app', 'zelle', 'wise', 'revolut', 'chase', 'wellsfargo', 'wells-fargo',
  'bankofamerica', 'citibank', 'citi', 'capitalone', 'capital-one', 'americanexpress', 'amex', 'visa',
  'mastercard', 'coinbase', 'binance', 'kraken', 'robinhood', 'schwab', 'fidelity', 'vanguard',
  'hsbc', 'barclays', 'santander', 'klarna', 'affirm', 'square', 'plaid', 'bitcoin', 'ethereum',
  'metamask', 'opensea', 'westernunion', 'moneygram', 'payoneer', 'skrill', 'paytm', 'razorpay',
  'applepay', 'googlepay', 'usbank', 'pnc', 'tdbank', 'sofi', 'chime'
]) as h
on conflict (handle) do nothing;

--
-- Link-in-bio competitors: 40
insert into public.reserved_handles (handle, reason, kind)
select h, 'Link-in-bio competitors', 'admin'
from unnest(array[
  'linktree', 'linktr', 'linktr-ee', 'beacons', 'beacons-ai', 'biolink', 'bio-link', 'linkinbio',
  'link-in-bio', 'carrd', 'bento', 'lnk-bio', 'lnkbio', 'solo-to', 'later', 'milkshake', 'campsite',
  'stan', 'stan-store', 'koji', 'taplink', 'linkpop', 'komi', 'allmylinks', 'flowpage', 'hoo-be',
  'tap-bio', 'linkfire', 'lnk-to', 'bio-fm', 'shorby', 'heylink', 'bio-site', 'lit-link', 'lnk-fyi',
  'hydlink', 'hydelink', 'hydlnk-app', 'hydlnk-com', 'hydlink-app'
]) as h
on conflict (handle) do nothing;

--
-- Impersonation-prone words: 59
insert into public.reserved_handles (handle, reason, kind)
select h, 'Impersonation-prone words', 'admin'
from unnest(array[
  'staff', 'moderator', 'moderators', 'mod', 'mods', 'owner', 'ceo', 'founder', 'trust', 'safety',
  'trust-and-safety', 'verified', 'verification', 'authentic', 'customer-service', 'customerservice',
  'service', 'helpdesk', 'help-center', 'helpcenter', 'contact-us', 'compliance', 'recovery', 'reset',
  'password', 'passwords', 'account-security', 'security-team', 'support-team', 'hydlnk-support',
  'hydlnk-team', 'hydlnk-admin', 'hydlnk-staff', 'hydlnk-official', 'hydlnk-help', 'hydlnk-security',
  'hydlnk-billing', 'anonymous', 'administrator', 'sysadmin', 'superuser', 'operator', 'police',
  'fbi', 'irs', 'government', 'gov', 'whitehouse', 'cia', 'nasa', 'alerts', 'alert', 'notifications',
  'notification', 'verify-account', 'login-help', 'signin-help', 'official-support', 'official-team'
]) as h
on conflict (handle) do nothing;

-- END CURATED PRE-FILL: 274 entries (social and creator platforms 52, big tech and well-known consumer brands 74, payments and banks 49, link-in-bio competitors 40, impersonation-prone words 59).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Admin functions (service_role only; the route writes the admin_audit row)
-- ---------------------------------------------------------------------------

-- A page of the list, handle order. `p_query` is a substring (strpos, so % and _ are plain characters);
-- `p_kind` limits to 'system' or 'admin'. Each row names the page that already holds the handle, if any.
create function public.admin_list_reserved_handles(
  p_query text default '',
  p_kind text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  handle text,
  reason text,
  kind text,
  added_by uuid,
  created_at timestamptz,
  holder_page_id uuid,
  holder_owner_id uuid,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.handle, r.reason, r.kind, r.added_by, r.created_at, p.id, p.owner_id, count(*) over ()
  from public.reserved_handles r
  left join public.pages p on p.handle = r.handle
  where (p_kind is null or r.kind = p_kind)
    and (coalesce(btrim(p_query), '') = '' or strpos(r.handle, lower(btrim(p_query))) > 0)
  order by r.handle
  limit greatest(least(coalesce(p_limit, 100), 500), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Reserves a handle as kind 'admin'. outcome 'added', or 'exists' when it is already reserved (nothing
-- changes). Either way the current holder of the handle (a page that already uses it) comes back, with
-- the owner's email: adding a taken handle changes nothing for the holder. A handle that breaks the
-- handle rule raises 22023.
create function public.admin_add_reserved_handle(p_handle text, p_reason text, p_admin uuid)
returns table (
  outcome text,
  handle text,
  holder_page_id uuid,
  holder_owner_id uuid,
  holder_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_outcome text;
begin
  if v_handle !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$' then
    raise exception 'not a valid handle' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'the reason is at most 200 characters' using errcode = '22023';
  end if;
  if p_admin is null then
    raise exception 'the admin id is required' using errcode = '22023';
  end if;

  insert into public.reserved_handles as r (handle, reason, kind, added_by)
  values (v_handle, v_reason, 'admin', p_admin)
  on conflict on constraint reserved_handles_pkey do nothing;
  v_outcome := case when found then 'added' else 'exists' end;

  return query
    select v_outcome, v_handle, pg.id, pg.owner_id, u.email::text
    from (select 1) one
    left join public.pages pg on pg.handle = v_handle
    left join auth.users u on u.id = pg.owner_id;
end;
$$;

-- Removes a handle. 'removed', 'locked' (kind system: nothing changes) or 'missing'.
create function public.admin_remove_reserved_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  select r.kind into v_kind
  from public.reserved_handles r
  where r.handle = lower(btrim(coalesce(p_handle, '')))
  for update;
  if not found then
    return 'missing';
  end if;
  if v_kind = 'system' then
    return 'locked';
  end if;
  delete from public.reserved_handles r where r.handle = lower(btrim(p_handle));
  return 'removed';
end;
$$;

revoke all on function public.admin_list_reserved_handles(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_add_reserved_handle(text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_remove_reserved_handle(text) from public, anon, authenticated;
grant execute on function public.admin_list_reserved_handles(text, text, integer, integer) to service_role;
grant execute on function public.admin_add_reserved_handle(text, text, uuid) to service_role;
grant execute on function public.admin_remove_reserved_handle(text) to service_role;
