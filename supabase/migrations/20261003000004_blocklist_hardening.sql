-- HYDLNK Wave D hardening (M5-03): the save-time link blocklist, tightened after a security review.
-- Replaces three functions of 20261003000001 (same signatures, so grants and the trigger stay).
--
--   * `blocked_links_in`: the host of each URL is computed ONCE (a materialized CTE). The correlated
--     blocked_domains test used to re-evaluate the inlined `blocklist_url_host` about thirty times
--     per URL, so the cost of a save grew with the length of the blocklist (one URL with a long
--     percent-encoded authority cost about 5 ms with 12 entries, and far more with a few hundred).
--   * `enforce_link_blocklist`: refuses a draft over 262144 bytes before scanning it, because the
--     size CHECK runs after a BEFORE trigger.
--   * `blocklist_url_host`: the 512-character tail of a long host is taken AFTER the percent-escapes,
--     the ignored code points and the case and width folding are gone (a host padded with soft hyphens
--     used to lose its own head and was read as another host).
--
-- The save-time check stays a convenience: Publish decides with the platform's URL parser
-- (src/lib/blocklist/published.ts). Nothing here is destructive.

create or replace function public.blocklist_url_host(p_url text)
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
  -- Only now, after the percent-escapes, the ignored code points and the folding are gone, is the
  -- length of the host real: keep the last 512 characters (a blocked domain is a suffix). Cutting
  -- before that let a host padded with soft hyphens lose its own head.
  if char_length(v_host) > 512 then
    v_host := right(v_host, 512);
  end if;

  -- Forbidden host code points make the URL invalid: nothing a browser can open.
  if v_host = '' or v_host ~ '[\x01-\x20#%/:<>?@\[\\\]^|\x7f]' then
    return null;
  end if;
  return v_host;
end;
$$;

create or replace function public.blocked_links_in(p_draft jsonb)
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
  hosts as materialized (
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

create or replace function public.enforce_link_blocklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text;
  v_blocks text;
begin
  -- The size cap first: pages_draft_integrity (256 KB) is a CHECK, which Postgres evaluates AFTER a
  -- BEFORE trigger, so without this a draft of megabytes would be scanned before it was refused.
  if octet_length(new.draft::text) > 262144 then
    raise exception 'draft_too_large' using errcode = '23514';
  end if;
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

