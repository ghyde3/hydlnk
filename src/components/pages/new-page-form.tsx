"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { HandleField, type ServerHandleResult } from "@/components/auth/handle-field";
import { normalizeHandle } from "@/lib/handles/rules";
import { isHandleStatus } from "@/lib/handles/status";

const SIGNED_OUT_MESSAGE = "You’re signed out. Sign in again to create a page.";
const FAILED_MESSAGE = "Couldn’t create that page. Try again.";

/**
 * The form on /pages/new (M4-18, Signup.dc.html): the live-availability Handle field of Milestone 1
 * and a primary "Create page" button, both full width and at least 44px tall. Submitting posts
 * {handle} to /api/pages, the server-only create (reserved, taken, short, invalid and race rules are
 * the claim's, the plan's page limit is the database's). A taken or reserved handle shows the same
 * status line as the live check; the page limit shows its plan-specific message with a link to the
 * plans; success lands on /editor, which shows the new page (the route set the `hl-page` cookie).
 */
export function NewPageForm() {
  const [pending, setPending] = useState(false);
  const [serverResult, setServerResult] = useState<ServerHandleResult | null>(null);
  const [problem, setProblem] = useState<{ message: string; plans: boolean } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const raw = new FormData(event.currentTarget).get("handle");
    const handle = normalizeHandle(typeof raw === "string" ? raw : "");
    setPending(true);
    setProblem(null);
    setServerResult(null);
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      if (response.status === 201) {
        // A full navigation, on purpose: the cookie the route just set decides which page every
        // screen shows, and a client-side push could render from the previous page.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/editor");
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
        message?: unknown;
      } | null;
      const message = typeof body?.message === "string" ? body.message : null;
      if (response.status === 401) {
        setProblem({ message: SIGNED_OUT_MESSAGE, plans: false });
      } else if (isHandleStatus(body?.error) && body.error !== "available") {
        setServerResult({ handle, status: body.error });
      } else if (body?.error === "page_limit") {
        setProblem({ message: message ?? FAILED_MESSAGE, plans: true });
      } else {
        setProblem({ message: message ?? FAILED_MESSAGE, plans: false });
      }
    } catch {
      setProblem({ message: FAILED_MESSAGE, plans: false });
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <HandleField id="np-handle" serverResult={serverResult} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-[15px] font-semibold text-surface disabled:cursor-default disabled:opacity-70"
      >
        {pending ? "Creating…" : "Create page"}
      </button>
      {problem ? (
        <div role="alert" className="-mt-2 flex flex-col items-start gap-1 text-[13px] text-bad">
          <p>{problem.message}</p>
          {problem.plans ? (
            <Link
              href="/settings#plans"
              className="inline-flex min-h-11 items-center font-semibold text-ink underline"
            >
              See plans
            </Link>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
