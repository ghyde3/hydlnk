-- M15-05 (1b1-03): suggest_site_path is callable by no client role, and has the expected shape.

begin;
select plan(11);

select tests.create_supabase_user('a', 'a-203@example.test');

select is(public.suggest_site_path('About Us', '{}'), 'about-us', 'a plain title');
select is(public.suggest_site_path('Café Menü', '{}'), 'cafe-menu', 'accents folded');
select is(public.suggest_site_path('', '{}'), 'page', 'empty title falls back to page');
select is(public.suggest_site_path('api', '{}'), 'api-2', 'a reserved word gets a suffix');
select is(public.suggest_site_path('hl-query-count', '{}'), 'query-count', 'the hl- prefix is dropped');
select is(public.suggest_site_path('News', array['news', 'news-2']), 'news-3', 'taken paths are skipped');

select is(public.suggest_site_path('hl', array['hl']), 'page', 'hl taken falls back to page, never loops');
select is(public.suggest_site_path('hl', array['hl', 'page']), 'page-2', 'hl and page taken');

select tests.authenticate_as('a');
select throws_ok($$select public.suggest_site_path('x', '{}')$$, '42501', null,
  'authenticated cannot execute it');
select tests.clear_authentication();
set local role anon;
select throws_ok($$select public.suggest_site_path('x', '{}')$$, '42501', null,
  'anon cannot execute it');
reset role;

select is(
  (select p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
     from pg_proc p where p.oid = 'public.suggest_site_path(text, text[])'::regprocedure),
  'i:search_path=""', 'immutable with an empty search_path');

select * from finish();
rollback;
