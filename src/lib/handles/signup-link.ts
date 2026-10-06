import "server-only";
import { createClient } from "@supabase/supabase-js";
import { emailSchema } from "@/lib/auth/email";
import { classifyOtpError } from "@/lib/auth/otp-error";
import { clientEnv } from "@/lib/env/client";
import { PENDING_HANDLE_METADATA_KEY } from "./pending";

export type SignupLinkResult =
  | { ok: true }
  | { ok: false; error: "invalid_email" | "rate_limited" | "too_many_emails" | "failed" };

/**
 * Emails a sign-in link that carries the chosen handle (M1-12). The handle rides inside the
 * sign-in request itself (`user_metadata.pending_handle`, applied when the address is new), so the
 * link works on another device and nothing browser-local is involved. Same transport as log in
 * (src/lib/auth/magic-link.ts): a throwaway implicit-flow client, so the emailed link carries a
 * token hash that /auth/callback verifies without a PKCE verifier cookie. The caller has already
 * validated the handle server-side; this only ships it.
 */
export async function sendSignupLink(email: unknown, handle: string): Promise<SignupLinkResult> {
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
    options: { shouldCreateUser: true, data: { [PENDING_HANDLE_METADATA_KEY]: handle } },
  });
  if (!error) return { ok: true };

  const failure = classifyOtpError(error);
  if (failure !== "failed") return { ok: false, error: failure };
  console.error(
    "[handles] sending the signup link failed",
    error.code ?? error.status,
    error.message,
  );
  return { ok: false, error: "failed" };
}
