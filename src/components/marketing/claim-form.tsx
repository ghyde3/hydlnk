"use client";

import { useEffect, useRef } from "react";
import { appOrigin } from "@/lib/routing/urls";
import { signupUrl } from "./signup-handoff";

/** The shown suffix is brand copy, like "yourname.hydlnk.com" in the pricing list. */
const HANDLE_SUFFIX = ".hydlnk.com";

const VARIANTS = {
  light: {
    form: "border-line-3 bg-surface",
    input: "text-ink placeholder:text-text-3",
    suffix: "text-text-3",
    button: "bg-ink text-surface",
  },
  dark: {
    form: "border-ink-line bg-ink-raised",
    input: "text-on-ink placeholder:text-on-ink-muted",
    suffix: "text-on-ink-muted",
    button: "bg-brass text-ink",
  },
} as const;

/**
 * "Claim your handle". Without JavaScript it is a plain GET form to <app origin>/signup, so the raw
 * value arrives as typed and the signup page normalizes it. With JavaScript the submit is
 * intercepted so the visitor lands on signup?handle=<normalized value>, or on /signup with no
 * parameter when the field is empty. Handle availability is checked on the app host.
 */
export function ClaimForm({
  id,
  rootDomain,
  variant = "light",
}: {
  id: string;
  rootDomain: string;
  variant?: keyof typeof VARIANTS;
}) {
  const styles = VARIANTS[variant];
  const formRef = useRef<HTMLFormElement>(null);

  // Tests wait for this flag so they never click before the submit handler exists.
  useEffect(() => {
    formRef.current?.setAttribute("data-ready", "true");
  }, []);

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
      className={`flex w-full max-w-[500px] flex-wrap items-center gap-1.5 rounded-md border py-1 pr-1 pl-3.5 text-left focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brass ${styles.form}`}
    >
      <label htmlFor={id} className="sr-only">
        Choose your handle
      </label>
      <input
        id={id}
        name="handle"
        type="text"
        placeholder="yourname"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`min-h-11 min-w-0 flex-[1_1_110px] bg-transparent font-mono outline-none ${styles.input}`}
      />
      <span className={`shrink-0 font-mono text-base ${styles.suffix}`}>{HANDLE_SUFFIX}</span>
      <button
        type="submit"
        className={`min-h-11 flex-[1_1_100%] cursor-pointer rounded-sm px-[18px] text-sm font-semibold hl:ml-1.5 hl:flex-none ${styles.button}`}
      >
        Claim it
      </button>
    </form>
  );
}
