import type { HandleStatus } from "./status";

/**
 * What the signup and claim Server Actions hand back to their forms. Plain data, no server-only
 * imports, so the client components can import the types.
 *
 *   handle      the handle can't be used (taken, reserved, malformed...): the field shows the same
 *               status line as the live availability check and takes focus
 *   email       the email address is not valid
 *   error       anything else (rate limit, provider failure, suspended account...)
 *   sent        the sign-in link is on its way (`error` set when a resend failed)
 */
export type HandleFormState =
  | { kind: "idle" }
  | { kind: "handle"; handle: string; status: HandleStatus }
  | { kind: "email"; message: string }
  | { kind: "error"; message: string }
  | { kind: "sent"; email: string; handle: string; error?: string };

export const IDLE_FORM_STATE: HandleFormState = { kind: "idle" };

export const RATE_LIMITED_MESSAGE = "You can request another link in a minute.";
/** Supabase's hourly email limit answered (M5-20): waiting a minute will not help. */
export { TOO_MANY_EMAILS_MESSAGE } from "@/lib/auth/otp-error";
export const SEND_FAILED_MESSAGE = "We couldn’t send the link. Try again in a moment.";
export const CHECK_UNAVAILABLE_MESSAGE = "Couldn’t check that handle. Try again.";
export const CLAIM_FAILED_MESSAGE = "Couldn’t claim that handle. Try again.";
export const SUSPENDED_MESSAGE = "This account can’t claim a handle.";
