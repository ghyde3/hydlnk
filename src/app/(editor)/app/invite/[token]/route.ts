import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin, protocolFor } from "@/lib/routing/urls";
import { INVITE_COOKIE, inviteCookieOptions } from "@/lib/team/resume";
import { isInviteToken } from "@/lib/team/token";

export const dynamic = "force-dynamic";

/**
 * GET /invite/{token} on the app host (M19-08): the link in the invite email. It writes nothing in
 * the database (T12): it keeps the token in the HttpOnly invite cookie and sends the person on, with
 * no return-URL parameter: to /login when signed out (the sign-in comes back to /invite through
 * `resumeInvite`), to /invite when signed in, where accepting is a POST. A token that is not one
 * goes to /invite too, which says the link no longer works. No Referer leaves with the token.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  const origin = appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  const response = NextResponse.redirect(new URL(user ? "/invite" : "/login", origin), 303);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  if (isInviteToken(token)) {
    const secure = protocolFor(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN) === "https";
    response.cookies.set(INVITE_COOKIE, token, inviteCookieOptions(secure));
  }
  return response;
}
