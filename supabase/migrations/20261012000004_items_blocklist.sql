-- HYDLNK M12-01 security review: the optional link of each item of an `items` block goes through the
-- link blocklist like every other link.
--
-- `blocked_links_in` also reads `blocks[].items[].url` (an `items` block only; a faq block's items
-- carry no url), reporting the item's own id as item_id. The trigger `enforce_link_blocklist`
-- runs this function for pages.draft and site_pages.draft alike, so both are covered. Same
-- signature, language, volatility and security settings, so grants and triggers stay as they are.
-- The 600-URL cap of the scan still bounds one save. Nothing is destructive.

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
    union all
    -- Links inside text (M6-28): only the link marks of a text block.
    select blocks.blk ->> 'id', m.value ->> 'id', m.value -> 'url'
    from blocks
    cross join lateral jsonb_array_elements(
      case
        when blocks.blk ->> 'type' = 'text' and jsonb_typeof(blocks.blk -> 'marks') = 'array'
          then blocks.blk -> 'marks'
        else '[]'::jsonb
      end
    ) as m(value)
    where jsonb_typeof(m.value) = 'object' and m.value ->> 'type' = 'link'
    union all
    -- The store links of a book or an app-store block (M9-15), by the entry's id.
    select blocks.blk ->> 'id', l.value ->> 'id', l.value -> 'url'
    from blocks
    cross join lateral jsonb_array_elements(
      case
        when blocks.blk ->> 'type' in ('book', 'apps') and jsonb_typeof(blocks.blk -> 'links') = 'array'
          then blocks.blk -> 'links'
        else '[]'::jsonb
      end
    ) as l(value)
    where jsonb_typeof(l.value) = 'object'
    union all
    -- The optional link of each item of an items block (M12-01), by the item's id.
    select blocks.blk ->> 'id', it.value ->> 'id', it.value -> 'url'
    from blocks
    cross join lateral jsonb_array_elements(
      case
        when blocks.blk ->> 'type' = 'items' and jsonb_typeof(blocks.blk -> 'items') = 'array'
          then blocks.blk -> 'items'
        else '[]'::jsonb
      end
    ) as it(value)
    where jsonb_typeof(it.value) = 'object'
    union all
    -- The support banner (M9-23): the page's own top-level key, no block.
    select 'banner'::text, p_draft -> 'banner' ->> 'id', p_draft -> 'banner' -> 'url'
    where jsonb_typeof(p_draft -> 'banner') = 'object'
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
