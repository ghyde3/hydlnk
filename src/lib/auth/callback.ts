import "server-only";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";
import { accountHasPage } from "@/lib/handles/claim";
import { PENDING_HANDLE_COOKIE } from "@/lib/handles/pending";
import { appOrigin } from "@/lib/routing/urls";
import { createServerSupabase } from "@/lib/supabase/server";
import { ensureAccount } from "./accounts";

/** What /login shows for each `?error=` code. Anything else is ignored. */
export type LoginErrorCode = "link_invalid";

/**
 * Token-hash types the emailed link may carry. The templates emit `email`; `magiclink` and `signup`
 * are the names the Supabase admin API and older templates use. Anything else (recovery, invite,
 * email_change) is not a sign-in link and is treated as an invalid one.
 */
const EMAIL_LINK_TYPES: ReadonlySet<string> = new Set(["email", "magiclink", "signup"]);

function redirectTo(path: string): NextResponse {
  // The destination is built from NEXT_PUBLIC_ROOT_DOMAIN, never from the request: no query
  // parameter (next, redirect_to, ...) and no Host header can steer it.
  const response = NextResponse.redirect(
    new URL(path, appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

const loginError = (code: LoginErrorCode) => redirectTo(`/login?error=${code}`);

/**
 * GET /auth/callback (app host only; the proxy only rewrites the app host to this route).
 *
 *   ?token_hash=...&type=email   emailed sign-in link: verifyOtp, no PKCE verifier cookie needed, so
 *                                it works in a different browser than the one that asked for it
 *   ?code=...                    an OAuth (PKCE) code: exchange it for a session (the app no longer
 *                                starts that flow itself; Google sign-in is an ID token, M1-29)
 *   ?error=...                   Supabase reports a failure
 *   (nothing)                    back to /login
 *
 * Success always lands on "/", which the auth gate routes onward (/editor or /claim). Every failure
 * lands on /login, with a fixed error code at most. Nothing in the query string chooses where to go.
 */
export async function handleAuthCallback(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const tokenHash = params.get("token_hash");
  const code = params.get("code");

  if (tokenHash === null && code === null) {
    // Supabase reports a used or expired link this way (error_code=otp_expired), and any other
    // failure ends the same: back to /login with the one notice there is. Google sign-in no longer
    // comes through here (its button hands the page an ID token), so there is no provider notice.
    if (params.has("error") || params.has("error_code")) return loginError("link_invalid");
    return redirectTo("/login");
  }

  const supabase = await createServerSupabase();
  let userId: string | undefined;

  if (tokenHash !== null) {
    const type = params.get("type") ?? "email";
    if (!EMAIL_LINK_TYPES.has(type)) return loginError("link_invalid");
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    // otp_expired (used or expired) and invalid tokens end the same way, with no session set.
    if (error || !data.user) return loginError("link_invalid");
    userId = data.user.id;
  } else if (code !== null) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return loginError("link_invalid");
    userId = data.user.id;
  }

  if (userId) {
    try {
      // The database trigger already made the row; this covers a missing one. The id comes from
      // Supabase's verify response, not from the request.
      await ensureAccount(userId);
    } catch (error) {
      // Signing in worked; requireUser() retries the self-heal on the next page load.
      console.error("[auth] ensureAccount failed in callback", error);
    }
  }

  const response = redirectTo("/");
  // A handle chosen before Google sign-in waits in a cookie until /claim/resume claims it. An
  // account that already has a page never claims another, so drop the cookie right here instead of
  // leaving it for its 15 minutes (M1-13).
  if (userId && request.headers.get("cookie")?.includes(`${PENDING_HANDLE_COOKIE}=`)) {
    try {
      if (await accountHasPage(userId)) response.cookies.delete(PENDING_HANDLE_COOKIE);
    } catch (error) {
      console.error("[auth] page lookup failed in callback", error);
    }
  }
  return response;
}
