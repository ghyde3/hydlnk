-- HYDLNK Wave N (admin) security review, findings 2 and 3.
--
-- 2. `accounts.plan` is the effective plan: recompute_account_plan() derives it from paid_plan and the
--    gift. The trigger fired only on an update of paid_plan or a gift column, so a direct write of
--    `plan` (any server code, a hand-run statement) stuck until the next such update. It now fires on
--    `plan` too: whatever is written there, the stored value is the derived one.
--
-- 3. `gifted_by` is an admin's auth user id and the owner could read it through the table-level SELECT
--    that `authenticated` held on accounts. That grant becomes a column list without `gifted_by`
--    (`gift_reason` stays readable: the gift form tells the admin the owner can read it). A column
--    added to accounts later is not readable by the owner until it is added to this list on purpose.

drop trigger recompute_account_plan on public.accounts;
create trigger recompute_account_plan
  before update of plan, paid_plan, gift_plan, gift_until, gift_reason, gifted_by, gifted_at on public.accounts
  for each row execute function public.recompute_account_plan();

revoke select on public.accounts from authenticated;
grant select (
  id, plan, stripe_customer_id, suspended_at, created_at, updated_at, stripe_subscription_id,
  billing_interval, current_period_end, cancel_at_period_end, stripe_event_created_at,
  paid_plan, gift_plan, gift_until, gift_reason, gifted_at
) on public.accounts to authenticated;

comment on column public.accounts.gifted_by is
  'The admin who gave the plan: a plain auth user id (admins are ADMIN_USER_IDS), no foreign key. Not readable by authenticated (column-level SELECT omits it).';
