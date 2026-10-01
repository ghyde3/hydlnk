"use client";

import { useEffect, useId, useRef, useState } from "react";
import { normalizeHandle, validateHandle, HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import {
  CHECKING_MESSAGE,
  CHECK_FAILED_MESSAGE,
  describeHandleStatus,
  isHandleStatus,
  type HandleStatus,
  type StatusTone,
} from "@/lib/handles/status";
import { useBrandHandle } from "./brand-handle";

/** A status handed back by a Server Action for the handle it validated. */
export interface ServerHandleResult {
  handle: string;
  status: HandleStatus;
}

/** Wait this long after the last keystroke before asking the endpoint (the spec allows 400 ms). */
const DEBOUNCE_MS = 300;

type CheckState = { handle: string; status: HandleStatus | "error" };

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-text-2",
  good: "text-good",
  bad: "text-bad",
};

/**
 * The Handle field of the signup and claim forms (M1-11, Signup.dc.html): a mono input with the
 * ".hydlnk.com" suffix and a live status line underneath.
 *
 *  - Normalizes as you type (lowercase, only a-z 0-9 and "-"), never truncates, no maxlength.
 *  - Malformed values (short, too long, bad dashes) are judged locally with the shared rules.
 *    Well-formed ones ask GET /api/handles/check after a debounce; the status line says
 *    "Checking…" until THAT handle's answer is in, so a stale answer can never show.
 *  - Keeps the brand panel's pill in step through useBrandHandle().
 *  - Never blocks the form: the Server Action validates again, and a failed check only says so.
 *
 * `serverResult` lets a form show what its Server Action decided (and puts focus here).
 */
export function HandleField({
  id,
  initialValue = "",
  serverResult,
}: {
  id?: string;
  initialValue?: string;
  serverResult?: ServerHandleResult | null;
}) {
  const reactId = useId();
  const fieldId = id ?? `handle-${reactId.replace(/:/g, "")}`;
  const statusId = `${fieldId}-status`;
  const [value, setValue] = useState(() => normalizeHandle(initialValue));
  const [check, setCheck] = useState<CheckState | null>(null);
  const { setHandle } = useBrandHandle();
  const localRef = useRef<HTMLInputElement>(null);
  const firstRun = useRef(true);

  const handle = normalizeHandle(value);
  const rule = validateHandle(handle);

  // Ask the endpoint about a well-formed handle: at once for a prefilled value, debounced after.
  useEffect(() => {
    if (rule !== "ok") return;
    const controller = new AbortController();
    const delay = firstRun.current ? 0 : DEBOUNCE_MS;
    firstRun.current = false;

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/handles/check?handle=${encodeURIComponent(handle)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`check failed: ${response.status}`);
        const body: unknown = await response.json();
        const status = (body as { status?: unknown } | null)?.status;
        if (!isHandleStatus(status)) throw new Error("unexpected response");
        setCheck({ handle, status });
      } catch {
        // An aborted request belongs to a handle that has since changed: say nothing about it.
        if (!controller.signal.aborted) setCheck({ handle, status: "error" });
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [handle, rule]);

  // A Server Action's verdict moves focus here (the same message the live check shows).
  useEffect(() => {
    if (serverResult) localRef.current?.focus();
  }, [serverResult]);

  // What the status line says. Every answer is keyed by the handle it was given for, so a
  // result for an earlier value can never be shown for the current one.
  let status: HandleStatus | null = null;
  let tone: StatusTone = "neutral";
  let message = CHECKING_MESSAGE;
  let busy = false;
  if (rule !== "ok") {
    status = rule;
  } else if (serverResult && serverResult.handle === handle) {
    status = serverResult.status;
  } else if (check && check.handle === handle) {
    if (check.status === "error") message = CHECK_FAILED_MESSAGE;
    else status = check.status;
  } else {
    busy = true;
  }
  if (status) ({ tone, message } = describeHandleStatus(status, handle));

  const hasProblem = status !== null && status !== "available" && status !== "short";
  const border = hasProblem ? "border-bad" : status === "short" ? "border-line-2" : "border-line-3";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-semibold">
        Handle
      </label>
      <div
        className={`flex min-h-12 items-center gap-0.5 rounded-md border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brass ${border}`}
      >
        <input
          ref={localRef}
          id={fieldId}
          name="handle"
          type="text"
          value={value}
          onChange={(event) => {
            const next = normalizeHandle(event.target.value);
            setValue(next);
            setHandle(next);
          }}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={statusId}
          aria-invalid={hasProblem ? true : undefined}
          className="min-h-11 min-w-0 flex-auto bg-transparent font-mono text-base text-ink outline-none"
        />
        <span className="flex-none font-mono text-base text-text-3">.{HANDLE_DISPLAY_DOMAIN}</span>
      </div>
      <div
        id={statusId}
        aria-live="polite"
        aria-busy={busy || undefined}
        className="min-h-5 text-[13px] leading-5"
      >
        <span className={`inline-flex items-start gap-1.5 ${TONE_TEXT[tone]}`}>
          {status === "available" ? (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="mt-[3px] size-3.5 flex-none fill-none stroke-current stroke-[2.4]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : null}
          <span className="[overflow-wrap:anywhere]">{message}</span>
        </span>
      </div>
    </div>
  );
}
