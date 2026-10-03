"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react";
import { requestSignInLink } from "@/lib/auth/actions";
import { EMAIL_ERROR, emailSchema } from "@/lib/auth/email";
import { TOO_MANY_EMAILS_MESSAGE } from "@/lib/auth/otp-error";
import Link from "next/link";
import { AuthHeading } from "./auth-heading";
import { GoogleButton, OrDivider } from "./google-button";

const RESEND_SECONDS = 60;
const subscribeNever = () => () => {};
const RATE_LIMITED = "You can request another link in a minute.";
const SEND_FAILED = "We couldn’t send the link. Try again in a moment.";

const primaryButton =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-[15px] font-semibold text-surface disabled:cursor-default disabled:opacity-70";
const secondaryButton =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-[15px] font-semibold text-ink disabled:cursor-default disabled:text-text-3";

/**
 * The log in column: email field, 'Email me a sign-in link', 'or', Google. After a successful
 * request it swaps to the sent state in place ('Check your email', a 60 s resend countdown and
 * 'Use a different email'). `notice` is an error from /auth/callback shown above the form;
 * `status` is a neutral message (account deleted) shown in the same place.
 */
export function LoginForm({ notice, status }: { notice?: string; status?: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Arriving with a message from /auth/callback (a link that expired or was already used): the
  // field is the next thing to touch, so it has the focus (M5-20).
  useEffect(() => {
    if (notice) inputRef.current?.focus();
  }, [notice]);

  // The buttons stay disabled until React has hydrated the form, so a tap that comes too early
  // cannot submit a native GET form (which would put the address in the URL). The field itself is
  // uncontrolled, so anything typed before hydration survives it.
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  // Countdown: derived from the clock, so it stays right when the tab sleeps or time is jumped.
  useEffect(() => {
    if (sentTo === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [sentTo, resendAt]);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function send(address: string, fromResend: boolean) {
    startTransition(async () => {
      const result = await requestSignInLink(address);
      if (result.ok) {
        setError(null);
        setSentTo(address);
        const next = Date.now() + RESEND_SECONDS * 1000;
        setNow(Date.now());
        setResendAt(next);
        return;
      }
      if (result.error === "rate_limited" || result.error === "too_many_emails") {
        // The typed address stays in the field (it is uncontrolled and the form does not unmount).
        setError(result.error === "rate_limited" ? RATE_LIMITED : TOO_MANY_EMAILS_MESSAGE);
        if (fromResend) setResendAt(Date.now() + RESEND_SECONDS * 1000);
      } else {
        setError(result.error === "invalid_email" ? EMAIL_ERROR : SEND_FAILED);
      }
      if (!fromResend) inputRef.current?.focus();
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(inputRef.current?.value ?? "");
    if (!parsed.success) {
      setError(EMAIL_ERROR);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    send(parsed.data, false);
  }

  function useDifferentEmail() {
    setSentTo(null);
    setError(null);
    // The input mounts empty with the form; focus it on the next frame.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  if (sentTo !== null) {
    return (
      <div>
        <AuthHeading
          title="Check your email"
          intro={
            <>
              We emailed a sign-in link to <span className="font-semibold text-ink">{sentTo}</span>.
            </>
          }
        />
        <div className="mt-7 flex flex-col gap-3">
          <button type="button" onClick={useDifferentEmail} className={secondaryButton}>
            Use a different email
          </button>
          <button
            type="button"
            disabled={remaining > 0 || pending}
            onClick={() => send(sentTo, true)}
            className={secondaryButton}
          >
            {remaining > 0 ? `Resend in ${remaining}s` : "Resend link"}
          </button>
          {error ? (
            <p role="alert" className="text-[13px] text-bad">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <AuthHeading title="Log in" />
      {notice ? (
        <p role="alert" className="mt-4 text-[15px] leading-normal text-bad">
          {notice}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="mt-4 text-[15px] leading-normal text-ink">
          {status}
        </p>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="mt-7 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-email" className="text-sm font-semibold">
            Email
          </label>
          <input
            ref={inputRef}
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-email-error" : undefined}
            className="min-h-12 rounded-md border border-line-3 bg-surface px-3 text-base text-ink"
          />
          {error ? (
            <p id="login-email-error" role="alert" className="text-[13px] text-bad">
              {error}
            </p>
          ) : null}
        </div>
        <button type="submit" disabled={!ready || pending} className={primaryButton}>
          Email me a sign-in link
        </button>
        <OrDivider />
        <GoogleButton disabled={!ready} />
      </form>
      <p className="mt-6 flex flex-wrap items-center gap-x-1.5 text-sm text-text-2">
        New here?
        <Link
          href="/signup"
          className="inline-flex min-h-11 min-w-11 items-center font-semibold text-ink"
        >
          Create your page
        </Link>
      </p>
    </div>
  );
}
