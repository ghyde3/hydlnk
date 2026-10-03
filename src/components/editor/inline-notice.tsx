"use client";

import type { ReactNode } from "react";

/**
 * An inline error with at most one action: "Couldn’t publish. Your draft is safe. Try again." and
 * its Retry button (M5-15). `role="alert"`, DESIGN.md error colors, a 44px action. The copy comes
 * from the caller; nothing from a server error ever reaches it.
 */
export function InlineNotice({
  children,
  action,
  kind,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean } | undefined;
  kind: string;
}) {
  return (
    <div
      role="alert"
      data-inline-notice={kind}
      className="flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
    >
      <span className="py-2">{children}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="inline-flex min-h-11 items-center rounded-md border border-bad-line bg-surface px-4 text-[13px] font-semibold text-bad disabled:cursor-progress disabled:opacity-70"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
