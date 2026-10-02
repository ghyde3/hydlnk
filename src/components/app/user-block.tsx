import { initialsOf } from "@/lib/pages/initials";

/**
 * Sidebar user block: a 30px initials circle, with the account name over the email beneath it
 * (Billing.dc.html). No profile name exists yet, so the name line is the local part of the email.
 * Both lines truncate to the 240px sidebar.
 */
export function UserBlock({ email }: { email: string }) {
  const name = email.split("@")[0] ?? email;
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span
        aria-hidden="true"
        className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-ink-2 text-xs font-semibold text-on-ink"
      >
        {initialsOf(email)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-on-ink" title={name}>
          {name}
        </div>
        <div className="truncate text-xs text-on-ink-muted" title={email}>
          {email}
        </div>
      </div>
    </div>
  );
}
