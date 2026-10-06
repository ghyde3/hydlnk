"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ConnectedApp } from "@/lib/oauth/grants";
import {
  CONNECTED_APPS_EMPTY,
  NOT_USED_YET,
  REGISTERED_NOT_VERIFIED_SHORT,
  REVOKE_LABEL,
  SCOPE_ABILITIES,
  connectedOn,
  lastUsedOn,
  revokeLabelFor,
  revokedNotice,
} from "@/lib/oauth/messages";
import { revokeConnectedApp } from "./connected-apps-actions";

/**
 * The rows of the Connected apps card and their Revoke buttons. Revoking asks nothing first (the row
 * says what is lost, and the person can connect again): it calls the server action, drops the row and
 * says "{name} can no longer access your pages." in a status region that outlives the row.
 */
export function ConnectedAppsList({ apps }: { apps: ConnectedApp[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(apps);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // A fresh server render (after router.refresh) replaces what the list shows.
  const [seen, setSeen] = useState(apps);
  if (seen !== apps) {
    setSeen(apps);
    setRows(apps);
  }

  async function revoke(app: ConnectedApp) {
    setPendingId(app.id);
    setNotice(null);
    setErrors((current) => ({ ...current, [app.id]: "" }));
    let message: string | null = null;
    try {
      const result = await revokeConnectedApp(app.id);
      if (result.ok) {
        setRows((current) => current.filter((row) => row.id !== app.id));
        setNotice(revokedNotice(app.name));
        startTransition(() => router.refresh());
      } else {
        message = result.message;
      }
    } catch {
      message = "We couldn’t revoke that app. Try again.";
    }
    if (message) setErrors((current) => ({ ...current, [app.id]: message! }));
    setPendingId(null);
  }

  return (
    <div data-connected-apps="" className="flex flex-col gap-2">
      <p role="status" aria-live="polite" className="text-sm text-ink empty:hidden">
        {notice}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-text-2">{CONNECTED_APPS_EMPTY}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((app) => (
            <li
              key={app.id}
              data-connected-app={app.name}
              className="flex flex-col gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0 hl:flex-row hl:items-center hl:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
                  {app.name}
                </span>
                <span className="min-w-0 text-[13px] text-text-2 [overflow-wrap:anywhere]">
                  {app.address ? (
                    <>
                      Address: <span className="font-mono">{app.address}</span>
                    </>
                  ) : (
                    REGISTERED_NOT_VERIFIED_SHORT
                  )}
                </span>
                <ul className="flex flex-col gap-0.5 text-[13px] text-text-2">
                  {app.scopes.map((scope) => (
                    <li key={scope}>{SCOPE_ABILITIES[scope]}</li>
                  ))}
                </ul>
                <span className="text-[13px] text-text-2">
                  {connectedOn(app.connectedOn)}
                  <span aria-hidden="true"> · </span>
                  <span className="block hl:inline">
                    {app.lastUsedOn ? lastUsedOn(app.lastUsedOn) : NOT_USED_YET}
                  </span>
                </span>
                {errors[app.id] ? (
                  <span role="alert" className="text-[13px] text-bad">
                    {errors[app.id]}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={revokeLabelFor(app.name)}
                disabled={pendingId !== null}
                onClick={() => void revoke(app)}
                className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 hl:w-auto"
              >
                {REVOKE_LABEL}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
