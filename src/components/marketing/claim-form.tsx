"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import { appOrigin } from "@/lib/routing/urls";
import { claimHint, DEFAULT_IDLE_HINT } from "./claim-hint";
import { signupUrl } from "./signup-handoff";

/** The shown suffix is brand copy, like "you.hydlnk.com" in the pricing list. */
const HANDLE_SUFFIX = `.${HANDLE_DISPLAY_DOMAIN}`;
const PLACEHOLDER = "you";

/**
 * Both variants sit on charcoal, which is what makes the field the loudest thing on the page: a
 * white field and a cobalt button (the marketing primary accent, marketing.css).
 *  - light: for a light page. The form brings its own charcoal panel.
 *  - dark: for a charcoal band. The band is the panel, so the form adds none.
 */
const VARIANTS = {
  light: "rounded-md bg-ink p-4 shadow-[0_0_0_6px_var(--hl-brass-soft)] hl:p-5",
  dark: "",
} as const;

/**
 * "Claim your handle". The field reads as the finished address: what you type sits right in front
 * of ".hydlnk.com", so "you.hydlnk.com" turns into your own link as you type. Without
 * JavaScript it is a plain GET form to <app origin>/signup, so the raw value arrives as typed and
 * the signup page normalizes it. With JavaScript the submit is intercepted so the visitor lands on
 * signup?handle=<normalized value>, or on /signup with no parameter when the field is empty.
 * Whether the name is free is checked on the app host (the sign-up page), never here.
 *
 * `idleHint` is the line under the field while it is empty. Once there is text, that line says
 * what the name will become (see claim-hint.ts).
 */
export function ClaimForm({
  id,
  rootDomain,
  variant = "light",
  idleHint = DEFAULT_IDLE_HINT,
}: {
  id: string;
  rootDomain: string;
  variant?: keyof typeof VARIANTS;
  idleHint?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [typed, setTyped] = useState("");

  // Tests wait for this flag so they never click before the submit handler exists. It also picks
  // up a value the browser restored (back navigation, autofill) that fired no input event.
  useEffect(() => {
    if (inputRef.current) setTyped(inputRef.current.value);
    formRef.current?.setAttribute("data-ready", "true");
  }, []);

  const hint = claimHint(typed, idleHint);
  // The input is as wide as its text (one monospace character is one ch), so the suffix follows
  // the last letter. min-w-11 keeps a short word a 44px target; max-w-full lets it stop growing
  // and scroll once the row is full.
  const width = `calc(${Math.max(typed.length, PLACEHOLDER.length)}ch + 2px)`;

  return (
    <form
      ref={formRef}
      method="get"
      action={`${appOrigin(rootDomain)}/signup`}
      onSubmit={(event) => {
        event.preventDefault();
        const raw = new FormData(event.currentTarget).get("handle");
        window.location.assign(signupUrl(rootDomain, typeof raw === "string" ? raw : ""));
      }}
      className={`w-full max-w-[520px] text-left ${VARIANTS[variant]}`}
    >
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-on-ink">
        Choose your handle
      </label>
      <div className="flex flex-col gap-2 hl:flex-row">
        {/* Tapping anywhere in the white field types into the input, even past the suffix. */}
        <div
          onClick={() => inputRef.current?.focus()}
          className="flex min-w-0 flex-1 cursor-text items-center overflow-hidden rounded-sm bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brass"
        >
          <input
            ref={inputRef}
            id={id}
            name="handle"
            type="text"
            data-claim-handle=""
            placeholder={PLACEHOLDER}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={hintId}
            aria-invalid={hint.invalid || undefined}
            onChange={(event) => setTyped(event.currentTarget.value)}
            style={{ width }}
            className="h-14 max-w-full min-w-11 bg-transparent p-0 font-mono text-[18px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-text-3"
          />
          <span className="shrink-0 font-mono text-[18px] text-text-2">{HANDLE_SUFFIX}</span>
        </div>
        <button
          type="submit"
          className="min-h-14 w-full cursor-pointer rounded-sm bg-accent px-7 text-base font-semibold whitespace-nowrap text-surface transition-colors hover:bg-accent-hover motion-reduce:transition-none hl:w-auto"
        >
          Claim it
        </button>
      </div>
      {/* Read when the field is focused (aria-describedby), not announced per keystroke. A div, not
          a p, so long-form prose styles (.prose-hl p) never recolor it on a charcoal panel. */}
      <div
        id={hintId}
        className="mt-3 min-h-5 text-[13px] leading-5 text-on-ink-muted-2 [overflow-wrap:anywhere]"
      >
        {hint.message}
      </div>
    </form>
  );
}
