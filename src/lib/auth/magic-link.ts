import "server-only";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";
import { emailSchema } from "./email";
import { classifyOtpError } from "./otp-error";

export type SendLinkResult =
  | { ok: true }
  | { ok: false; error: "invalid_email" | "rate_limited" | "too_many_emails" | "failed" };

/**
 * Asks Supabase to email a sign-in link. Used by the log in and sign up actions.
 *
 * The result is the same for an address with an account and one without (the project creates the
 * user on first request), so nothing here reveals whether an account exists. Rate limits are
 * reported as `rate_limited` so the UI can say 'You can request another link in a minute.' instead
 * of showing Supabase's own error text, or as `too_many_emails` ('Too many sign-in emails. Try again
 * in a little while.') when the hourly email limit is what answered (see ./otp-error).
 *
 * A throwaway client with the implicit flow sends the request: the emailed link carries a token
 * hash that /auth/callback verifies, so no PKCE verifier cookie is needed (or written), and the
 * link signs in in whichever browser opens it.
 */
export async function sendSignInLink(email: unknown): Promise<SendLinkResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "invalid_email" };

  const supabase = createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        flowType: "implicit",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true },
  });
  if (!error) return { ok: true };

  // The same address inside a minute and the hourly email limit are different answers (M5-20).
  const failure = classifyOtpError(error);
  if (failure !== "failed") return { ok: false, error: failure };
  console.error(
    "[auth] sending the sign-in link failed",
    error.code ?? error.status,
    error.message,
  );
  return { ok: false, error: "failed" };
}
