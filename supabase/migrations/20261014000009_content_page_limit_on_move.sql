-- M15-03 (review fix): the page limit (HL008) also holds when a page leaves Home.
--
-- enforce_content_entry_limit ran on insert and on a type_id change only. Home ('/') is exempt from
-- the count, so a page entry created at '/' and then moved to another path (a draft update) was never
-- counted: a Free owner could hold any number of non-Home pages. The trigger now also fires on a
-- change of draft or published. For an update that keeps the type, only a page whose old path was '/'
-- and whose new path is not is counted, exactly as an insert of that page would be.

create or replace function public.enforce_content_entry_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_plan text;
  v_key text;
  v_max integer;
  v_count integer;
  v_same_type boolean := tg_op = 'UPDATE' and old.type_id is not distinct from new.type_id;
begin
  select t.key into v_key from public.content_types t where t.id = new.type_id;
  if v_key is null then
    return new; -- an unknown type fails its foreign key
  end if;

  if v_same_type then
    -- Only a page that stops being Home is a new page for the count.
    if v_key <> 'page'
       or not (coalesce(old.draft ->> 'path', '') = '/' or coalesce(old.published ->> 'path', '') = '/')
    then
      return new;
    end if;
  end if;

  -- Home is always one of the site's pages and is never what tips the count over.
  if v_key = 'page' and (new.draft ->> 'path' = '/' or new.published ->> 'path' = '/') then
    return new;
  end if;

  select p.owner_id into v_owner
    from public.pages p
    where p.id = new.site_id
    for no key update;
  if not found then
    raise exception 'site % does not exist', new.site_id using errcode = '23503';
  end if;
  select a.plan into v_plan from public.accounts a where a.id = v_owner;

  if v_key = 'page' then
    select l.pages_per_site into v_max from public.plan_limits(v_plan) l;
    select 1 + count(*) into v_count
      from public.content_entries e
      join public.content_types t on t.id = e.type_id
      where e.site_id = new.site_id and t.key = 'page' and e.id <> new.id
        and coalesce(e.draft ->> 'path', '') <> '/' and coalesce(e.published ->> 'path', '') <> '/';
    if v_max is not null and v_count >= v_max then
      raise exception 'page limit reached: the % plan allows % page(s) per site, Home included', v_plan, v_max
        using errcode = 'HL008';
    end if;
    return new;
  end if;

  select l.entries_per_type into v_max from public.plan_limits(v_plan) l;
  select count(*) into v_count from public.content_entries e where e.type_id = new.type_id;

  if v_max is not null and v_count >= v_max then
    raise exception 'entry limit reached: the % plan allows % entries per type, trash included', v_plan, v_max
      using errcode = 'HL010';
  end if;
  return new;
end;
$$;

drop trigger enforce_entry_limit on public.content_entries;
create trigger enforce_entry_limit before insert or update of type_id, draft, published on public.content_entries
  for each row execute function public.enforce_content_entry_limit();
