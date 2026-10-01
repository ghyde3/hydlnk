"use client";

import { useState } from "react";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * 'Continue with Google'. Starts Supabase's PKCE OAuth flow: the browser client stores the code
 * verifier in a host-only cookie on this (app) host and navigates to
 * {SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=<app>/auth/callback&code_challenge=...
 * The redirect target is the bare callback path, exactly what the Supabase allow-list holds.
 */
export function GoogleButton({
  className = "",
  disabled = false,
}: {
  className?: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    const { error } = await createBrowserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/auth/callback` },
    });
    // On success the browser is already navigating away.
    if (error) setPending(false);
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={pending || disabled}
      className={`flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-[15px] font-semibold text-ink disabled:cursor-default disabled:opacity-70 ${className}`}
    >
      Continue with Google
    </button>
  );
}

/** The 'or' rule between the email button and the Google button. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-[13px] text-text-3" role="separator">
      <span className="block h-px flex-auto bg-line" />
      or
      <span className="block h-px flex-auto bg-line" />
    </div>
  );
}
