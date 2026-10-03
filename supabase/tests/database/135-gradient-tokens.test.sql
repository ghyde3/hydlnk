-- M6-41: the gradient tokens (gradientAngle 180, gradientFrom null, gradientTo null) are added to
-- every stored complete token set that lacks them by the migration
-- 20261006000000_gradient_tokens.sql. The end state is checked on the migrated database (system
-- themes and the seeded published page). The migration's own statements (the block below, repeated
-- from the migration verbatim; tests/unit/m6-gradient-migration.test.ts compares the two) are then
-- run again on rows that still lack the keys, to prove what they change and what they leave alone.

begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- End state of the migrated database
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select name from public.themes
      where not (tokens ?& array['gradientAngle', 'gradientFrom', 'gradientTo']) $$,
  'no theme row (system or saved) lacks the three gradient keys'
);
select is_empty(
  $$ select handle from public.pages
      where jsonb_typeof(published -> 'tokens') = 'object'
        and not (published -> 'tokens' ?& array['gradientAngle', 'gradientFrom', 'gradientTo']) $$,
  'no published page lacks the three gradient keys in its frozen tokens'
);
select is(
  (select count(*)::int from public.themes
     where owner_id is null
       and name in ('Noir', 'Ivory', 'Smoke', 'Paper', 'Sage', 'Midnight', 'Ember')
       and (tokens -> 'gradientAngle') = '180'::jsonb
       and jsonb_typeof(tokens -> 'gradientFrom') = 'null'
       and jsonb_typeof(tokens -> 'gradientTo') = 'null'),
  7,
  'the seven system themes that existed before carry the defaults: 180 degrees, no custom colors'
);
select is(
  (select tokens ->> 'accent' || '/' || (tokens ->> 'bgType') from public.themes where name = 'Smoke'),
  '#9DB3C4/gradient',
  'a system theme keeps its other values (Smoke accent and gradient background)'
);
select is(
  (select published #>> '{tokens,gradientAngle}' from public.pages where handle = 'mara'),
  '180',
  'the seeded published page freezes the default angle'
);

-- ---------------------------------------------------------------------------
-- The rewrite itself, on rows that still lack the keys
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('gr', 'gr@example.test');

insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-0000000000e1', tests.get_supabase_uid('gr'), 'Old complete',
   '{"bg":"#101010","surface":"#202020","text":"#EEEEEE","textMuted":"#AAAAAA","accent":"#C46A4F","buttonBg":"#C46A4F","buttonText":"#101010","border":"#303030","fontHeading":"Inter","fontBody":"Inter","scale":1,"weightHeading":600,"letterCase":"normal","radius":12,"borderWidth":1,"buttonStyle":"fill","density":"regular","maxWidth":480,"align":"center","bgType":"gradient","bgImage":null,"overlayOpacity":0,"blur":0}'),
  ('00000000-0000-4000-8000-0000000000e2', tests.get_supabase_uid('gr'), 'Already set',
   '{"bg":"#101010","surface":"#202020","text":"#EEEEEE","textMuted":"#AAAAAA","accent":"#C46A4F","buttonBg":"#C46A4F","buttonText":"#101010","border":"#303030","fontHeading":"Inter","fontBody":"Inter","scale":1,"weightHeading":600,"letterCase":"normal","radius":12,"borderWidth":1,"buttonStyle":"fill","density":"regular","maxWidth":480,"align":"center","bgType":"gradient","bgImage":null,"overlayOpacity":0,"blur":0,"gradientAngle":135,"gradientFrom":"#C46A4F","gradientTo":"#1B1814"}'),
  ('00000000-0000-4000-8000-0000000000e3', tests.get_supabase_uid('gr'), 'Partial',
   '{"accent":"#112233","radius":20}');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000000000e4', tests.get_supabase_uid('gr'), 'gradient-values',
   '{"version":1,"rev":7,"profile":{"name":"G","bio":"","photo":null},"theme":{"ref":null,"overrides":{"accent":"#778899"}},"blocks":[]}',
   '{"version":1,"profile":{"name":"G","bio":"","photo":null},"theme":{"ref":null,"overrides":{"accent":"#778899"}},"blocks":[],"tokens":{"bg":"#101010","surface":"#202020","text":"#EEEEEE","textMuted":"#AAAAAA","accent":"#778899","buttonBg":"#778899","buttonText":"#101010","border":"#303030","fontHeading":"Inter","fontBody":"Inter","scale":1,"weightHeading":600,"letterCase":"normal","radius":12,"borderWidth":1,"buttonStyle":"fill","density":"regular","maxWidth":480,"align":"center","bgType":"gradient","bgImage":null,"overlayOpacity":0,"blur":0}}',
   '2026-09-30 12:00:00+00');

select is(
  (select tokens ?| array['gradientAngle', 'gradientFrom', 'gradientTo'] from public.themes where name = 'Old complete'),
  false,
  'precondition: the test theme has no gradient keys'
);

-- >>> rewrite
create function pg_temp.hl_add_gradient_tokens(t jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when t is null or jsonb_typeof(t) <> 'object' then t
    -- Complete means all 23 keys the token set had before the gradient: only those are completed.
    when not (t ?& array[
      'bg', 'surface', 'text', 'textMuted', 'accent', 'buttonBg', 'buttonText', 'border',
      'fontHeading', 'fontBody', 'scale', 'weightHeading', 'letterCase', 'radius', 'borderWidth',
      'buttonStyle', 'density', 'maxWidth', 'align', 'bgType', 'bgImage', 'overlayOpacity', 'blur'
    ]) then t
    when t ?& array['gradientAngle', 'gradientFrom', 'gradientTo'] then t
    else jsonb_build_object('gradientAngle', 180, 'gradientFrom', null, 'gradientTo', null) || t
  end
$$;

update public.themes
  set tokens = pg_temp.hl_add_gradient_tokens(tokens)
  where pg_temp.hl_add_gradient_tokens(tokens) is distinct from tokens;

update public.pages
  set published = jsonb_set(published, '{tokens}', pg_temp.hl_add_gradient_tokens(published -> 'tokens'))
  where jsonb_typeof(published -> 'tokens') = 'object'
    and pg_temp.hl_add_gradient_tokens(published -> 'tokens') is distinct from published -> 'tokens';
-- <<< rewrite

select is(
  (select tokens ->> 'gradientAngle' || '/' || (tokens -> 'gradientFrom')::text || '/' || (tokens -> 'gradientTo')::text
     from public.themes where name = 'Old complete'),
  '180/null/null',
  'a complete saved theme gets 180 degrees and no custom colors'
);
select is(
  (select tokens ->> 'accent' || '/' || (tokens ->> 'bgType') || '/' || (tokens ->> 'radius')
     from public.themes where name = 'Old complete'),
  '#C46A4F/gradient/12',
  'a completed theme keeps its other values'
);
select is(
  (select count(*)::int from public.themes t, jsonb_object_keys(t.tokens) where t.name = 'Old complete'),
  26,
  'a completed theme has all 26 keys'
);
select is(
  (select tokens ->> 'gradientAngle' || '/' || (tokens ->> 'gradientFrom') || '/' || (tokens ->> 'gradientTo')
     from public.themes where name = 'Already set'),
  '135/#C46A4F/#1B1814',
  'a theme that already has gradient values keeps them'
);
select is(
  (select tokens::text from public.themes where name = 'Partial'),
  '{"accent": "#112233", "radius": 20}',
  'a partial theme row is not completed'
);
select is(
  (select published #>> '{tokens,gradientAngle}' || '/' || (published #> '{tokens,gradientFrom}')::text
          || '/' || (published #> '{tokens,gradientTo}')::text
     from public.pages where handle = 'gradient-values'),
  '180/null/null',
  'a published page: the frozen tokens gain the three defaults'
);
select is(
  (select published #>> '{tokens,accent}' || '/' || (published #>> '{tokens,bgType}')
     from public.pages where handle = 'gradient-values'),
  '#778899/gradient',
  'a published page: the other frozen tokens are kept'
);
select is(
  (select published -> 'theme' -> 'overrides' from public.pages where handle = 'gradient-values')::text,
  '{"accent": "#778899"}',
  'a published page: the override copy in the published document is untouched'
);
select is(
  (select draft::text from public.pages where handle = 'gradient-values'),
  '{"rev": 7, "theme": {"ref": null, "overrides": {"accent": "#778899"}}, "blocks": [], "profile": {"bio": "", "name": "G", "photo": null}, "version": 1}',
  'the draft, revision included, is untouched'
);
select is(
  (select published_at from public.pages where handle = 'gradient-values'),
  '2026-09-30 12:00:00+00'::timestamptz,
  'published_at is untouched'
);

-- Re-running it changes nothing.
create temp table before_rerun as
  select 'themes' as src, id::text as id, tokens::text as body from public.themes
  union all
  select 'pages', id::text, published::text from public.pages where published is not null;

update public.themes
  set tokens = pg_temp.hl_add_gradient_tokens(tokens)
  where pg_temp.hl_add_gradient_tokens(tokens) is distinct from tokens;
update public.pages
  set published = jsonb_set(published, '{tokens}', pg_temp.hl_add_gradient_tokens(published -> 'tokens'))
  where jsonb_typeof(published -> 'tokens') = 'object'
    and pg_temp.hl_add_gradient_tokens(published -> 'tokens') is distinct from published -> 'tokens';

select is_empty(
  $$ select 1 from before_rerun b
       left join (select 'themes' as src, id::text as id, tokens::text as body from public.themes
                  union all
                  select 'pages', id::text, published::text from public.pages where published is not null) a
         using (src, id)
      where a.body is distinct from b.body $$,
  'running the rewrite a second time changes nothing'
);
select is(
  (select count(*)::int from public.pages where published is null and handle = 'mara'),
  0,
  'the seeded page keeps its published document'
);
select is_empty(
  $$ select name from public.themes
      where not (tokens ?& array['gradientAngle', 'gradientFrom', 'gradientTo'])
        and tokens ?& array['bg', 'surface', 'text', 'textMuted', 'accent', 'buttonBg', 'buttonText', 'border',
                            'fontHeading', 'fontBody', 'scale', 'weightHeading', 'letterCase', 'radius', 'borderWidth',
                            'buttonStyle', 'density', 'maxWidth', 'align', 'bgType', 'bgImage', 'overlayOpacity', 'blur'] $$,
  'afterwards no complete theme lacks the three keys'
);

select * from finish();
rollback;
