"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { HandleField, type ServerHandleResult } from "@/components/auth/handle-field";
import { normalizeHandle } from "@/lib/handles/rules";
import { isHandleStatus } from "@/lib/handles/status";
import { SITE_TEMPLATES, isSiteTemplateId } from "@/lib/site-templates/catalog";
import { setPendingTemplate } from "@/lib/site-templates/pending";

const SIGNED_OUT_MESSAGE = "You’re signed out. Sign in again to create a site.";
const FAILED_MESSAGE = "Couldn’t create that site. Try again.";

/**
 * The form on /pages/new (M4-18, Signup.dc.html): the live-availability Handle field of Milestone 1
 * and a primary "Create site" button, both full width and at least 44px tall. Submitting posts
 * {handle} to /api/pages, the server-only create (reserved, taken, short, invalid and race rules are
 * the claim's, the plan's page limit is the database's). A taken or reserved handle shows the same
 * status line as the live check; the page limit shows its plan-specific message with a link to the
 * plans; success lands on /editor, which shows the new page (the route set the `hl-page` cookie).
 */
export function NewPageForm() {
  // A suspended owner cannot create pages (M5-09); POST /api/pages answers 403 account_suspended.
  const suspended = useAccountSuspended();
  const [pending, setPending] = useState(false);
  const [serverResult, setServerResult] = useState<ServerHandleResult | null>(null);
  const [problem, setProblem] = useState<{ message: string; plans: boolean } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const raw = new FormData(event.currentTarget).get("handle");
    const handle = normalizeHandle(typeof raw === "string" ? raw : "");
    const chosen = new FormData(event.currentTarget).get("template");
    const template = isSiteTemplateId(chosen) ? chosen : null;
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
        // The choice travels as a one-shot flag in this tab, not in the address (M12-03).
        if (template) setPendingTemplate(template);
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
      <fieldset
        data-testid="new-site-templates"
        className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
      >
        <legend className="mb-1 p-0 text-sm font-semibold">Start with</legend>
        <TemplateChoice
          value=""
          label="A blank page"
          detail="Add your own blocks."
          defaultChecked
        />
        {SITE_TEMPLATES.map((template) => (
          <TemplateChoice
            key={template.id}
            value={template.id}
            label={template.name}
            detail={template.pages.join(", ")}
          />
        ))}
      </fieldset>
      <button
        type="submit"
        disabled={pending || suspended}
        aria-busy={pending || undefined}
        title={suspended ? SUSPENDED_REASON : undefined}
        className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-[15px] font-semibold text-surface disabled:cursor-default disabled:opacity-70"
      >
        {pending ? "Creating…" : "Create site"}
      </button>
      {suspended ? <p className="-mt-2 text-[13px] text-bad">{SUSPENDED_REASON}</p> : null}
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

/** One radio card of the "Start with" choice: a 44px-tall label around the native radio. */
function TemplateChoice({
  value,
  label,
  detail,
  defaultChecked,
}: {
  value: string;
  label: string;
  detail: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line-3 bg-surface px-3 py-2 has-[:checked]:border-ink has-[:checked]:bg-page has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass">
      <input
        type="radio"
        name="template"
        value={value}
        defaultChecked={defaultChecked}
        data-testid="new-site-template"
        className="peer sr-only"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-xs text-text-2">{detail}</span>
      </span>
    </label>
  );
}
