-- HYDLNK Wave E security fix: "Mark reviewed" on a high-traffic flag (M5-10) is an admin action, so it
-- is audited like suspend, unsuspend and dismiss_report. The audit action check gains one value;
-- nothing else about the table changes (server only, append-only, RLS on with no policies).

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit
  add constraint admin_audit_action_check
  check (action in ('suspend', 'unsuspend', 'dismiss_report', 'review_traffic_flag'));

comment on table public.admin_audit is 'What an admin did (suspend, unsuspend, dismiss a report, mark a traffic flag reviewed). Append-only, written by the server with the secret key. No client access.';
