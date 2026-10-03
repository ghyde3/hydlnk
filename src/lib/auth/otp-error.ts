/**
 * What Supabase's answer to "email me a sign-in link" means for the person (M1-03, M5-20), as plain
 * data so the mapping is testable without Supabase. No `server-only` and no imports.
 *
 * Supabase answers `over_email_send_rate_limit` (HTTP 429) for two different limits:
 *   - the same address asked again inside 60 seconds: "For security purposes, you can only request
 *     this after N seconds." The M1 wording stands: "You can request another link in a minute."
 *   - the project's emails per hour ("email rate limit exceeded"): the person did nothing wrong and
 *     waiting a minute will not help: "Too many sign-in emails. Try again in a little while."
 * They are told apart by the message, because the code is the same. Any other 429 (a request
 * rate limit) keeps the M1 wording. The raw text never reaches the page.
 */

export type OtpFailure = "rate_limited" | "too_many_emails" | "failed";

export const TOO_MANY_EMAILS_MESSAGE = "Too many sign-in emails. Try again in a little while.";

const PER_ADDRESS = /only request this after/i;

export function classifyOtpError(error: {
  status?: number | undefined;
  code?: string | undefined;
  message?: string | undefined;
}): OtpFailure {
  if (error.code === "over_email_send_rate_limit") {
    return PER_ADDRESS.test(error.message ?? "") ? "rate_limited" : "too_many_emails";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") return "rate_limited";
  return "failed";
}
