import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { INVITE_TTL_DAYS } from "./constants";
import { isInviteToken } from "./token";

/**
 * Opening an invite link signed out, and coming back to it, without a return-URL parameter (M19-08).
 * GET /invite/{token} stores the token in one HttpOnly, SameSite=Lax, host-only cookie (Secure in
 * production) and answers a 303: to /login when signed out, to /invite when signed in. The GET
 * writes nothing in the database (T12: a mail scanner's prefetch consumes nothing). Wherever the app
 * decides the first screen after a sign-in, `resumeInvite` sends a person holding the cookie to
 * /invite, where accepting is a POST (a Server Action). The token grants nothing by itself: accepting
 * needs the signed-in session whose confirmed email is the invited one (HL021).
 */
export const INVITE_COOKIE = "hl_invite";
/** As long as the invite itself can live: a person may sign up in between. */
export const INVITE_COOKIE_SECONDS = INVITE_TTL_DAYS * 24 * 60 * 60;

export function inviteCookieOptions(secure: boolean, maxAge = INVITE_COOKIE_SECONDS) {
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure, maxAge };
}

/** The token the cookie holds, when it is one. */
export async function pendingInviteToken(): Promise<string | null> {
  const value = (await cookies()).get(INVITE_COOKIE)?.value;
  return isInviteToken(value) ? value : null;
}

/** Sends a signed-in person holding an invite to /invite; returns when there is none. */
export async function resumeInvite(): Promise<void> {
  if (await pendingInviteToken()) redirect("/invite");
}

/**
 * Why the last Accept on this device was refused for good (S7): the invite cookie is dropped then, so
 * /invite re-renders without a token; this one-minute HttpOnly cookie lets it say why (another
 * address, a password session, a used link) instead of only "this link doesn't work".
 */
export const INVITE_RESULT_COOKIE = "hl_invite_result";
const INVITE_RESULT_SECONDS = 60;

/** Drops the invite cookie and its result (a Server Action or a route handler only). */
export async function clearInviteCookie(): Promise<void> {
  try {
    const jar = await cookies();
    jar.delete(INVITE_COOKIE);
    jar.delete(INVITE_RESULT_COOKIE);
  } catch {
    // A Server Component: they expire on their own.
  }
}

/** Drops the invite cookie and records why (S7). */
export async function endInvite(reason: string, secure: boolean): Promise<void> {
  await clearInviteCookie();
  try {
    (await cookies()).set(INVITE_RESULT_COOKIE, reason, inviteCookieOptions(secure, INVITE_RESULT_SECONDS));
  } catch {
    // Not in an action: nothing to show.
  }
}

/** The recorded reason, when it is one of `known` (anything else reads as none). */
export async function inviteResult<T extends string>(known: readonly T[]): Promise<T | null> {
  const value = (await cookies()).get(INVITE_RESULT_COOKIE)?.value;
  return known.find((reason) => reason === value) ?? null;
}
