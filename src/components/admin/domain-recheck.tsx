"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FAILED = "That didn’t work. Try again.";
const SIGNED_OUT = "You’re signed out. Sign in again.";

interface RecheckResponse {
  verified?: boolean;
  released?: boolean;
  message?: string | null;
}

/**
 * "Re-check now" for one domain (M13-04): POSTs `/api/admin/domains/{id}/recheck`, which runs the same
 * verification as the five-minute cron, shows the new result and refreshes the list (a domain that
 * verified leaves it). The server checks the caller is an admin again.
 */
export function DomainRecheckButton({
  domainId,
  hostname,
}: {
  domainId: string;
  hostname: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; bad: boolean } | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(`/api/admin/domains/${encodeURIComponent(domainId)}/recheck`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json().catch(() => null)) as
        (RecheckResponse & { message?: string }) | null;
      if (response.ok) {
        const text = body?.verified
          ? "Verified. The domain is live."
          : (body?.message ?? "Checked. Not verified yet.");
        setResult({ text, bad: false });
        router.refresh();
      } else if (response.status === 401) {
        setResult({ text: SIGNED_OUT, bad: true });
      } else {
        setResult({ text: typeof body?.message === "string" ? body.message : FAILED, bad: true });
      }
    } catch {
      setResult({ text: FAILED, bad: true });
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        aria-label={`Re-check ${hostname} now`}
        className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Checking..." : "Re-check now"}
      </button>
      {result ? (
        <p
          role={result.bad ? "alert" : "status"}
          data-testid="recheck-result"
          className={`text-xs leading-snug ${result.bad ? "text-bad" : "text-text-2"}`}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
