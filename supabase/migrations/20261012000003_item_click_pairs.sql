-- HYDLNK Wave M2 (M12-01): item clicks.
--
-- `items` blocks hold `items: [{id, ...}]`, ids unique across the site. site_click_pairs (same
-- signature, security definer, empty search_path, service_role only) now also returns the
-- (item id, sub-page id) pairs of items inside `items` blocks (`blocks[].items[].id` where the block's
-- type is "items") explicitly, besides the depth-8 walk of every `id`, `googleId` and `appleId`
-- (src/lib/analytics/ingest/site-index.ts mirrors both).
create or replace function public.site_click_pairs(p_page_id uuid)
returns table (block_id text, sub_page_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.block_id, s.id
  from public.site_pages s
  cross join lateral (
    select jsonb_path_query(s.published, '$.**{0 to 8} ? (@.type() == "object").id ? (@.type() == "string")') #>> '{}' as block_id
    union all
    select jsonb_path_query(s.published, '$.**{0 to 8} ? (@.type() == "object").googleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(s.published, '$.**{0 to 8} ? (@.type() == "object").appleId ? (@.type() == "string")') #>> '{}'
    union all
    select jsonb_path_query(s.published, '$.blocks[*] ? (@.type == "items").items[*].id ? (@.type() == "string")') #>> '{}'
  ) as i
  where s.page_id = p_page_id and s.published is not null
$$;

revoke all on function public.site_click_pairs(uuid) from public, anon, authenticated;
grant execute on function public.site_click_pairs(uuid) to service_role;
