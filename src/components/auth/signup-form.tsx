"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { submitSignup } from "@/lib/handles/actions";
import { IDLE_FORM_STATE, type HandleFormState } from "@/lib/handles/form-state";
import { handleDisplayHost, normalizeHandle } from "@/lib/handles/rules";
import { GoogleButton, OrDivider } from "./google-button";
import { useGoogleHandleGate } from "./google-handle-gate";
import { HandleField, type ServerHandleResult } from "./handle-field";

const primaryButton =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-[15px] font-semibold text-surface disabled:cursor-default disabled:opacity-70";
const secondaryButton =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-[15px] font-semibold text-ink disabled:cursor-default disabled:opacity-70";

const HANDLE_FIELD_ID = "su-handle";

/**
 * The signup column (M1-11, M1-12, M1-13, M1-30, Signup.dc.html): Handle field with live
 * availability, Email, "Email me a sign-in link", an "or" rule and Google's own sign-in button. The
 * page around it (heading, legal line, log in link) belongs to the signup page.
 *
 * The email button's Server Action (submitSignup) validates the handle on the server before any
 * email goes out or any cookie is set, and its verdict comes back here as the same status line the
 * live check shows. After a successful request the form gives way to the "Check your email" state;
 * the form stays mounted (hidden) so "Use a different email" returns to it with the handle still
 * filled in.
 *
 * Google's button is a separate flow (GoogleButton): it carries the handle to its own Server
 * Action, which validates it again before signing anyone in. The button can't be pressed until the
 * handle is known to be usable (useGoogleHandleGate); a press while it isn't moves focus to the
 * handle field, whose status line already says why.
 */
export function SignupForm({ initialHandle = "" }: { initialHandle?: string }) {
  const [state, action, pending] = useActionState(submitSignup, IDLE_FORM_STATE);
  const [email, setEmail] = useState("");
  const [dismissed, setDismissed] = useState<HandleFormState | null>(null);
  const [googleRefusal, setGoogleRefusal] = useState<ServerHandleResult | null>(null);
  // Tracks what is typed in the handle field (the field itself is HandleField's), through the
  // input events that bubble up to the form.
  const [handle, setHandle] = useState(() => normalizeHandle(initialHandle));
  const googleGate = useGoogleHandleGate(handle);
  const emailRef = useRef<HTMLInputElement>(null);

  const emailServerResult = useMemo<ServerHandleResult | null>(
    () => (state.kind === "handle" ? { handle: state.handle, status: state.status } : null),
    [state],
  );
  // Whichever verdict came last: the email action's (re-created per submit) or Google's.
  const serverResult = googleRefusal ?? emailServerResult;
  const showSent = state.kind === "sent" && dismissed !== state;

  useEffect(() => {
    if (state.kind === "email") emailRef.current?.focus();
  }, [state]);

  function chooseAnotherEmail() {
    setDismissed(state);
    setEmail("");
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  const emailError = state.kind === "email" ? state.message : null;
  const formError = state.kind === "error" ? state.message : null;

  return (
    <>
      <form
        action={action}
        noValidate
        hidden={showSent}
        className="flex flex-col gap-5"
        onInput={(event) => {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.name === "handle") {
            setHandle(normalizeHandle(target.value));
            setGoogleRefusal(null);
          }
        }}
      >
        <HandleField
          id={HANDLE_FIELD_ID}
          initialValue={initialHandle}
          serverResult={serverResult}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="su-email" className="text-sm font-semibold">
            Email
          </label>
          <input
            ref={emailRef}
            id="su-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "su-email-error" : undefined}
            className="min-h-12 rounded-md border border-line-3 bg-surface px-3 text-base text-ink"
          />
          {emailError ? (
            <p id="su-email-error" role="alert" className="text-[13px] text-bad">
              {emailError}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          name="intent"
          value="email"
          disabled={pending}
          className={primaryButton}
        >
          Email me a sign-in link
        </button>
        {formError ? (
          <p role="alert" className="-mt-2 text-[13px] text-bad">
            {formError}
          </p>
        ) : null}

        <OrDivider />

        <GoogleButton
          handle={handle}
          blocked={googleGate.blocked}
          onBlockedPress={() => document.getElementById(HANDLE_FIELD_ID)?.focus()}
          onHandleRefused={({ handle: refused, status }) =>
            setGoogleRefusal({ handle: refused, status })
          }
        />
      </form>

      {showSent && state.kind === "sent" ? (
        <div>
          <h2 className="text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">
            Check your email
          </h2>
          <p className="mt-2 text-[15px] leading-normal text-text-2">
            We emailed a sign-in link to{" "}
            <span className="font-semibold text-ink [overflow-wrap:anywhere]">{state.email}</span>.
            Open it to claim{" "}
            <span className="font-semibold text-ink [overflow-wrap:anywhere]">
              {handleDisplayHost(state.handle)}
            </span>
            .
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <button type="button" onClick={chooseAnotherEmail} className={secondaryButton}>
              Use a different email
            </button>
            <form action={action} className="contents">
              <input type="hidden" name="handle" value={state.handle} />
              <input type="hidden" name="email" value={state.email} />
              <input type="hidden" name="resend" value="1" />
              <button
                type="submit"
                name="intent"
                value="email"
                disabled={pending}
                className={secondaryButton}
              >
                Resend link
              </button>
            </form>
            {state.error ? (
              <p role="alert" className="text-[13px] text-bad">
                {state.error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
