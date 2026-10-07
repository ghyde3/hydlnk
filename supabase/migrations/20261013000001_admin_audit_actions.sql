-- HYDLNK Wave N (admin), phase 1: the admin_audit action list grows with this wave's actions.
-- The table stays append-only, server only, RLS on with no policies (20261003000002_admin.sql).

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit
  add constraint admin_audit_action_check
  check (action in (
    'suspend', 'unsuspend', 'dismiss_report', 'review_traffic_flag', 'block_domain', 'unblock_domain',
    'gift_plan', 'end_gift', 'reserve_handle', 'unreserve_handle', 'recheck_domain', 'view_draft',
    'set_announcement', 'clear_announcement', 'block_app', 'unblock_app'
  ));

comment on table public.admin_audit is
  'What an admin did (suspend, unsuspend, dismiss a report, mark a traffic flag reviewed, block or unblock a domain, gift or end a plan, reserve or unreserve a handle, re-check a domain, view a draft, set or clear the announcement, block or unblock an app). Append-only, written by the server with the secret key. No client access.';
