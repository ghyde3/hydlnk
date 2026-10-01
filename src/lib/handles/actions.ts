"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { EMAIL_ERROR, emailSchema } from "@/lib/auth/email";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { createServerSupabase } from "@/lib/supabase/server";
import { checkHandle } from "./availability";
import { claimHandle } from "./claim";
import { normalizeHandle } from "./rules";
import {
  CHECK_UNAVAILABLE_MESSAGE,
  CLAIM_FAILED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SEND_FAILED_MESSAGE,
  SUSPENDED_MESSAGE,
  type HandleFormState,
} from "./form-state";
import { PENDING_HANDLE_COOKIE, PENDING_HANDLE_MAX_AGE_SECONDS } from "./pending";
import { sendSignupLink } from "./signup-link";

/*
 * Server Actions for /signup and /claim. Each one re-validates everything: the forms' live checks
 * are a convenience, these are the rules. The handle is normalized and checked (rules, reserved,
 * taken) BEFORE any email is sent, any cookie is set or any page is written.
 */

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Validated, available handle, or the form state that explains why not. */
async function requireAvailableHandle(
  raw: string,
): Promise<{ handle: string } | { failure: HandleFormState }> {
  try {
    const { handle, status } = await checkHandle(raw);
    if (status !== "available") return { failure: { kind: "handle", handle, status } };
    return { handle };
  } catch (error) {
    console.error("[handles] availability check in action failed", error);
    return { failure: { kind: "error", message: CHECK_UNAVAILABLE_MESSAGE } };
  }
}

/**
 * Sign up with an email link (M1-12). Handle first (so a taken name never costs an email), then the
 * address, then the request. `resend` is the sent state's 'Resend link': the same checks, but a
 * failure keeps the sent state on screen with the reason next to the button.
 */
async function requestSignupLink(formData: FormData, resend: boolean): Promise<HandleFormState> {
  const checked = await requireAvailableHandle(field(formData, "handle"));
  if ("failure" in checked) return checked.failure;

  const email = emailSchema.safeParse(field(formData, "email"));
  if (!email.success) return { kind: "email", message: EMAIL_ERROR };

  const result = await sendSignupLink(email.data, checked.handle);
  if (result.ok) return { kind: "sent", email: email.data, handle: checked.handle };

  const message =
    result.error === "rate_limited"
      ? RATE_LIMITED_MESSAGE
      : result.error === "invalid_email"
        ? EMAIL_ERROR
        : SEND_FAILED_MESSAGE;
  if (resend) return { kind: "sent", email: email.data, handle: checked.handle, error: message };
  return result.error === "invalid_email" ? { kind: "email", message } : { kind: "error", message };
}

/**
 * Sign up with Google (M1-13). The handle is validated first; only then does it ride to the OAuth
 * redirect in a short-lived, HttpOnly, host-only cookie (never in a URL), to be claimed by /claim
 * once the user is signed in. The redirect goes to Supabase's authorize endpoint (PKCE), whose
 * code verifier cookie is written by this same action.
 */
async function startGoogleSignup(formData: FormData): Promise<HandleFormState> {
  const checked = await requireAvailableHandle(field(formData, "handle"));
  if ("failure" in checked) return checked.failure;

  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${appOrigin(rootDomain)}/auth/callback`, skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    console.error("[handles] starting Google sign-in failed", error?.code ?? error?.status);
    return {
      kind: "error",
      message: "Google sign-in isn’t available right now. Try an email link.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(PENDING_HANDLE_COOKIE, checked.handle, {
    httpOnly: true,
    sameSite: "lax",
    secure: !appOrigin(rootDomain).startsWith("http://"),
    path: "/",
    maxAge: PENDING_HANDLE_MAX_AGE_SECONDS,
    // No `domain`: host-only, so tenant subdomains never receive it.
  });
  redirect(data.url);
}

/**
 * The signup form's one action (M1-12, M1-13). Which button was pressed arrives as `intent`:
 * "email" (default, also what Enter in a field submits) or "google". `resend=1` marks the sent
 * state's 'Resend link' form.
 */
export async function submitSignup(
  _previous: HandleFormState,
  formData: FormData,
): Promise<HandleFormState> {
  if (field(formData, "intent") === "google") return startGoogleSignup(formData);
  return requestSignupLink(formData, field(formData, "resend") === "1");
}

/**
 * The claim step's form (M1-14): claims the typed handle for the signed-in account. The owner is
 * the verified session user and nothing in the form can change that. Success lands on /editor.
 */
export async function claimHandleAction(
  _previous: HandleFormState,
  formData: FormData,
): Promise<HandleFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  let result;
  try {
    result = await claimHandle(user.id, field(formData, "handle"));
  } catch (error) {
    console.error("[handles] claim in action failed", error);
    return { kind: "error", message: CLAIM_FAILED_MESSAGE };
  }
  if (result.ok) {
    (await cookies()).delete(PENDING_HANDLE_COOKIE);
    redirect("/editor");
  }

  if (result.error === "page_limit") {
    // The account already has its page (a double submit): nothing left to claim.
    redirect("/editor");
  }
  if (result.error === "suspended") return { kind: "error", message: SUSPENDED_MESSAGE };
  if (result.error === "no_account") return { kind: "error", message: CLAIM_FAILED_MESSAGE };
  return {
    kind: "handle",
    handle: normalizeHandle(field(formData, "handle")),
    status: result.error,
  };
}
