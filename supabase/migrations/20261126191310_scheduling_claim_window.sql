-- HYDLNK Wave E (M20-08): claim_due_schedules takes its p_limit AFTER skip locked.
-- Tests: supabase/tests/database/223-schedule-worker, tests/unit/m20-schedule-core (two sessions).
--
-- 20261126184409 cut the candidate list to p_limit before locking, so a second run overlapping the
-- first got the first run's (locked, skipped) rows as its only candidates and claimed nothing, though
-- other rows were due. The candidates are now every due row within the per-owner cap (at most 5 rows
-- of one owner, oldest first, bounded at 1,000 rows), and the limit applies to the rows actually
-- locked. Same signature, same grants (create or replace keeps them).

create or replace function public.claim_due_schedules(
  p_limit integer default 25,
  p_lease interval default '3 minutes'
)
returns table (
  id uuid,
  claim uuid,
  action text,
  entry_id uuid,
  site_id uuid,
  owner_id uuid,
  created_by uuid,
  type_key text,
  run_at timestamptz,
  snapshot jsonb,
  attempts integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
  v_lease interval := least(greatest(coalesce(p_lease, interval '3 minutes'), interval '30 seconds'),
    interval '10 minutes');
begin
  for v_row in
    select s.id as sid, s.entry_id as eid from public.content_schedules s
      where s.status = 'pending' and s.run_at <= now() and s.attempts >= 5
        and (s.locked_until is null or s.locked_until < now())
      order by s.run_at limit 100
  loop
    -- Entry before schedule row, as everywhere; skip anything another transaction holds.
    perform 1 from public.content_entries e where e.id = v_row.eid for update skip locked;
    continue when not found;
    perform 1 from public.content_schedules s where s.id = v_row.sid for update skip locked;
    continue when not found;
    update public.content_schedules s
      set status = 'failed', result_code = 'retries', finished_at = now(), snapshot = null,
          claim = null, locked_until = null
      where s.id = v_row.sid and s.status = 'pending';
  end loop;

  return query
  with candidates as (
    select c.cid
      from (
        select s.id as cid, s.run_at as crun,
               row_number() over (partition by p.owner_id order by s.run_at, s.id) as n
          from public.content_schedules s
          join public.pages p on p.id = s.site_id
          where s.status = 'pending' and s.run_at <= now() and s.attempts < 5
            and (s.locked_until is null or s.locked_until < now())
      ) c
      where c.n <= 5
      order by c.crun, c.cid
      limit 1000
  ), locked as (
    select s.id as lid from public.content_schedules s
      where s.id in (select candidates.cid from candidates)
        and s.status = 'pending' and (s.locked_until is null or s.locked_until < now())
      order by s.run_at, s.id
      limit v_limit
      for update of s skip locked
  )
  update public.content_schedules s
    set claim = gen_random_uuid(), locked_until = now() + v_lease, attempts = s.attempts + 1
    from locked l, public.pages p, public.content_entries e, public.content_types t
    where s.id = l.lid and p.id = s.site_id and e.id = s.entry_id and t.id = e.type_id
    returning s.id, s.claim, s.action, s.entry_id, s.site_id, p.owner_id, s.created_by, t.key,
      s.run_at, s.snapshot, s.attempts;
end;
$$;
