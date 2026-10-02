-- M3-02 / M3-10: token values the old schema accepted and the strict one does not (letterCase
-- "none", weightHeading 800, a background image that is not a page-media URL) are rewritten by the
-- migration 20261002100004_normalize_legacy_token_values.sql. The end state is checked on the
-- migrated database. The migration's own statements (the block below, repeated from the migration
-- verbatim; tests/unit/legacy-token-values-migration.test.ts compares the two) are then run again on
-- rows that still hold legacy values, to prove what they change and what they leave alone.

begin;
select plan(18);

-- ---------------------------------------------------------------------------
-- End state of the migrated database
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select name from public.themes where tokens ->> 'letterCase' = 'none' $$,
  'no theme (system or saved) holds the legacy letterCase "none"'
);
select is(
  (select count(*)::int from public.themes
     where owner_id is null and tokens ->> 'letterCase' in ('normal', 'uppercase', 'lowercase')),
  7,
  'all seven system themes carry one of the three letterCase values'
);
select is(
  (select tokens ->> 'letterCase' from public.themes where name = 'Noir'),
  'normal',
  'Noir (a Milestone 0 theme) now says normal'
);
select is(
  (select published #>> '{tokens,letterCase}' from public.pages where handle = 'mara'),
  'normal',
  'the seeded published page carries letterCase normal in its frozen tokens'
);

-- ---------------------------------------------------------------------------
-- The rewrite itself, on rows that still hold legacy values
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('lc', 'lc@example.test');

insert into public.themes (id, owner_id, name, tokens) values
  ('00000000-0000-4000-8000-0000000000f1', tests.get_supabase_uid('lc'), 'Legacy',
   '{"letterCase":"none","weightHeading":800,"bgType":"image","bgImage":"https://images.example.com/bg.jpg","accent":"#112233"}'),
  ('00000000-0000-4000-8000-0000000000f2', tests.get_supabase_uid('lc'), 'Current',
   '{"letterCase":"uppercase","weightHeading":700,"bgType":"image","bgImage":"http://127.0.0.1:54321/storage/v1/object/public/page-media/u/a.webp","accent":"#445566"}');

insert into public.pages (id, owner_id, handle, draft, published, published_at) values
  ('00000000-0000-4000-8000-0000000000f3', tests.get_supabase_uid('lc'), 'legacy-values',
   '{"version":1,"rev":4,"profile":{"name":"L","bio":"","photo":null},"theme":{"ref":null,"overrides":{"letterCase":"none","accent":"#778899"}},"blocks":[]}',
   '{"version":1,"profile":{"name":"L","bio":"","photo":null},"theme":{"ref":null,"overrides":{"weightHeading":800,"letterCase":"none"}},"blocks":[],"tokens":{"letterCase":"none","weightHeading":800,"accent":"#778899"}}',
   '2026-09-30 12:00:00+00');

select is(
  (select tokens ->> 'letterCase' from public.themes where name = 'Legacy'), 'none',
  'precondition: the test theme holds "none"'
);

-- >>> rewrite
create function pg_temp.hl_normalize_tokens(t jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when t is null or jsonb_typeof(t) <> 'object' then t
    else t
      || case when t ->> 'letterCase' = 'none'
              then jsonb_build_object('letterCase', 'normal') else '{}'::jsonb end
      || case when t ->> 'weightHeading' = '800'
              then jsonb_build_object('weightHeading', 700) else '{}'::jsonb end
      || case when jsonb_typeof(t -> 'bgImage') = 'string'
                   and (t ->> 'bgImage') not like '%/storage/v1/object/public/page-media/%'
              then jsonb_build_object('bgImage', null)
                   || case when t ->> 'bgType' = 'image'
                           then jsonb_build_object('bgType', 'solid') else '{}'::jsonb end
              else '{}'::jsonb end
  end
$$;

update public.themes
  set tokens = pg_temp.hl_normalize_tokens(tokens)
  where pg_temp.hl_normalize_tokens(tokens) is distinct from tokens;

update public.pages
  set published = jsonb_set(published, '{tokens}', pg_temp.hl_normalize_tokens(published -> 'tokens'))
  where jsonb_typeof(published -> 'tokens') = 'object'
    and pg_temp.hl_normalize_tokens(published -> 'tokens') is distinct from published -> 'tokens';

update public.pages
  set published = jsonb_set(published, '{theme,overrides}', pg_temp.hl_normalize_tokens(published #> '{theme,overrides}'))
  where jsonb_typeof(published #> '{theme,overrides}') = 'object'
    and pg_temp.hl_normalize_tokens(published #> '{theme,overrides}') is distinct from published #> '{theme,overrides}';

update public.pages
  set draft = jsonb_set(draft, '{theme,overrides}', pg_temp.hl_normalize_tokens(draft #> '{theme,overrides}'))
  where jsonb_typeof(draft #> '{theme,overrides}') = 'object'
    and pg_temp.hl_normalize_tokens(draft #> '{theme,overrides}') is distinct from draft #> '{theme,overrides}';
-- <<< rewrite

select is(
  (select tokens::text from public.themes where name = 'Legacy'),
  '{"accent": "#112233", "bgType": "solid", "bgImage": null, "letterCase": "normal", "weightHeading": 700}',
  'a saved theme: none -> normal, 800 -> 700, a third-party image becomes none and solid; other keys kept'
);
select is(
  (select tokens::text from public.themes where name = 'Current'),
  '{"accent": "#445566", "bgType": "image", "bgImage": "http://127.0.0.1:54321/storage/v1/object/public/page-media/u/a.webp", "letterCase": "uppercase", "weightHeading": 700}',
  'a theme with only current values is not changed (a page-media image stays)'
);
select is(
  (select published #>> '{tokens,letterCase}' from public.pages where handle = 'legacy-values'),
  'normal',
  'a published page: the frozen tokens say normal'
);
select is(
  (select published #>> '{tokens,weightHeading}' from public.pages where handle = 'legacy-values'),
  '700',
  'a published page: the frozen heading weight 800 became 700'
);
select is(
  (select published #>> '{tokens,accent}' from public.pages where handle = 'legacy-values'),
  '#778899',
  'a published page: the other frozen tokens are kept'
);
select is(
  (select published #>> '{theme,overrides,letterCase}' from public.pages where handle = 'legacy-values'),
  'normal',
  'a published page: the override copy in the published document says normal too'
);
select is(
  (select published #>> '{theme,overrides,weightHeading}' from public.pages where handle = 'legacy-values'),
  '700',
  'a published page: the override copy of the heading weight is 700'
);
select is(
  (select draft #>> '{theme,overrides,letterCase}' || '/' || (draft ->> 'rev') from public.pages where handle = 'legacy-values'),
  'normal/4',
  'a draft override says normal and the draft revision is unchanged'
);
select is(
  (select published_at from public.pages where handle = 'legacy-values'),
  '2026-09-30 12:00:00+00'::timestamptz,
  'published_at is untouched'
);
select is(
  (select count(*)::int from public.pages where published is null and draft is not null and handle = 'mara'),
  0,
  'the seeded page keeps its published document'
);
select is_empty(
  $$ select handle from public.pages where published #>> '{tokens,letterCase}' = 'none'
        or draft #>> '{theme,overrides,letterCase}' = 'none' $$,
  'no page holds a legacy letterCase any more'
);
select is_empty(
  $$ select name from public.themes where tokens ->> 'weightHeading' = '800' $$,
  'no theme holds the removed heading weight 800'
);
select is(
  (select tokens ->> 'accent' from public.themes where name = 'Noir'),
  '#C9A86A',
  'a system theme keeps its other values (Noir accent)'
);

select * from finish();
rollback;
