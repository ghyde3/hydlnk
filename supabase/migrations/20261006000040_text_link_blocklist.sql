-- HYDLNK M6-29: links inside text blocks go through the link blocklist like every other link.
--
-- A text block (M6-28) may hold `marks`: bold and italic ranges and `{type: 'link', id, url, ...}`
-- ranges. `blocked_links_in` reads the `url` of every link mark of a text block and judges it exactly
-- like any other URL (the same host function, the same built-in and listed rules), reporting the
-- mark's `id` as `item_id`. Marks of other types, marks without a string `url`, and the `marks` of a
-- block that is not a text block are skipped.
--
-- Same signature, language, volatility and security settings as before, so the grants and the
-- `pages` trigger (`enforce_link_blocklist`) stay as they are. The 600-URL cap of the scan and the
-- 200-block and 256 KB caps of the trigger still bound the cost of one save. Nothing is destructive.

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
