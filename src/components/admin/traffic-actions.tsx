"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FAILED = "That didn’t work. Try again.";
const SIGNED_OUT = "You’re signed out. Sign in again.";

/** POST to the admin route with the session cookie. Resolves with an error sentence, or null. */
async function post(path: string): Promise<string | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (response.ok) return null;
    if (response.status === 401) return SIGNED_OUT;
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    return typeof body?.message === "string" ? body.message : FAILED;
  } catch {
    return FAILED;
  }
}

/**
 * "Mark reviewed" for one flag (M5-10): POSTs `/api/admin/traffic/{id}/reviewed` and refreshes the
 * list, so the row leaves the Unreviewed queue. The server checks the caller is an admin again
 * (403 for anyone else) and is idempotent, so a double click is harmless.
 */
export function MarkReviewedButton({ flagId, handle }: { flagId: string; handle: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setError(null);
    const failure = await post(`/api/admin/traffic/${encodeURIComponent(flagId)}/reviewed`);
    setPending(false);
    if (failure) setError(failure);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        aria-label={`Mark ${handle} reviewed`}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Marking..." : "Mark reviewed"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
