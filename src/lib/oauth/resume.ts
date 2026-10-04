import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OAUTH_RESUME_COOKIE, OAUTH_RESUME_COOKIE_SECONDS } from "./constants";
import { defaultOauthStore } from "./store-supabase";
import { isRequestId } from "./tokens";

/**
 * Signing in before consent, and coming back to it, without a return-URL parameter (M10-12).
 *
 * A valid authorize request from a signed-out person is stored as a pending row, and the answer is a
 * 303 to /login with NO query string plus one cookie, `hl_oauth_resume`, whose value is the pending
 * request's id (128 random bits), HttpOnly, SameSite=Lax, Path=/, ten minutes, host-only, Secure in
 * production. Everywhere the app decides the first screen after a sign-in, `resumeOauthRequest` looks
 * at that cookie first: when it names a pending request that is unexpired, unanswered and not bound to
 * another person, the person is sent to /oauth/authorize (no query), which draws the consent screen
 * for that request; in every other case, including a forged or random value, the cookie is cleared
 * (where a response can carry a cookie) and the usual landing happens, with no message.
 *
 * Nothing else reads the cookie, and the id grants nothing by itself: consent needs the signed-in
 * session and a form secret, and the request belongs to the first person who renders it.
 */

function cookieAttributes(secure: boolean, maxAge: number): string {
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The `Set-Cookie` value that starts the resume. `requestId` is always a freshly generated id. */
export function resumeCookieHeader(requestId: string, secure: boolean): string {
  return `${OAUTH_RESUME_COOKIE}=${requestId}; ${cookieAttributes(secure, OAUTH_RESUME_COOKIE_SECONDS)}`;
}

export function clearResumeCookieHeader(secure: boolean): string {
  return `${OAUTH_RESUME_COOKIE}=; ${cookieAttributes(secure, 0)}`;
}

/**
 * Does the resume cookie name a request `userId` may answer: pending, unexpired, and unbound or this
 * person's? Never redirects, so a route handler can fold the answer into its own response. When the
 * cookie names nothing usable it is cleared where the platform allows (a Server Action or a route
 * handler); a Server Component cannot write a cookie, so there an unusable cookie is left to its own
 * ten minutes (it is inert: the id grants nothing by itself).
 */
export async function oauthResumeAvailable(userId: string): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(OAUTH_RESUME_COOKIE)?.value;
  if (value === undefined) return false;

  let usable = false;
  if (isRequestId(value)) {
    try {
      const row = await defaultOauthStore().getRequest(value);
      usable =
        row !== null &&
        row.status === "pending" &&
        (row.user_id === null || row.user_id === userId) &&
        Date.parse(row.request_expires_at) > Date.now();
    } catch {
      usable = false;
    }
  }
  if (!usable) {
    try {
      jar.delete(OAUTH_RESUME_COOKIE);
    } catch {
      // A Server Component: the cookie cannot be written here and expires on its own.
    }
  }
  return usable;
}

/**
 * Sends `userId` on to the consent screen when the resume cookie names a request they may answer.
 * Call it from the places that decide the landing after a sign-in; it returns when there is nothing
 * to resume, and otherwise ends the request with a redirect to /oauth/authorize (no query).
 */
export async function resumeOauthRequest(userId: string): Promise<void> {
  if (await oauthResumeAvailable(userId)) redirect("/oauth/authorize");
}
