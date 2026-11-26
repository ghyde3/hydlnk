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

/** Drops the cookie (a Server Action or a route handler; a Server Component cannot write one). */
export async function clearInviteCookie(): Promise<void> {
  try {
    (await cookies()).delete(INVITE_COOKIE);
  } catch {
    // A Server Component: it expires on its own.
  }
}
