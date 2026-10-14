-- M15-05 (1b1-03): suggest_site_path(title, taken), the SQL port of suggestPath in
-- src/lib/document/path.ts. The move migration (1b1-04) uses it to rewrite the draft paths of
-- sub-pages that are blank, reserved, malformed or duplicated. Nothing calls it yet.
-- Parity with the TypeScript function is pinned by tests/unit/m15-suggest-path-parity.test.ts.
-- Immutable, security definer (so it may call is_reserved_site_path, which service_role cannot), empty search_path, executable by service_role only (no client role).

create function public.suggest_site_path(p_title text, p_taken text[] default '{}')
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_taken text[] := coalesce(p_taken, '{}');
  v_candidate text;
  v_suffix text;
  n int;
begin
  -- slugify: fold accents, lowercase, runs of other characters become one hyphen, 40 at most
  v_base := regexp_replace(normalize(coalesce(p_title, ''), nfkd), '[̀-ͯ]', '', 'g');
  v_base := lower(v_base);
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
  v_base := left(v_base, 40);
  v_base := regexp_replace(v_base, '-+$', '', 'g');
  -- a slug starting hl- is reserved whatever follows: drop the prefix
  while v_base like 'hl-%' loop
    v_base := substr(v_base, 4);
  end loop;
  v_base := regexp_replace(v_base, '^-+', '');
  if v_base = '' then
    v_base := 'page';
  end if;

  if v_base ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
     and not public.is_reserved_site_path(v_base)
     and not (v_base = any (v_taken)) then
    return v_base;
  end if;
  -- suggestPath never ends here: every suffixed form of 'hl' starts with the reserved 'hl-'. The
  -- move must not hang, so SQL falls back to 'page' (the one deliberate difference from the TS).
  if v_base = 'hl' then
    v_base := 'page';
    if not (v_base = any (v_taken)) then
      return v_base;
    end if;
  end if;
  n := 2;
  loop
    v_suffix := '-' || n::text;
    v_candidate := regexp_replace(left(v_base, 40 - length(v_suffix)), '-+$', '') || v_suffix;
    if v_candidate ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
       and not public.is_reserved_site_path(v_candidate)
       and not (v_candidate = any (v_taken)) then
      return v_candidate;
    end if;
    n := n + 1;
  end loop;
end;
$$;

revoke all on function public.suggest_site_path(text, text[]) from public, anon, authenticated;
grant execute on function public.suggest_site_path(text, text[]) to service_role;
