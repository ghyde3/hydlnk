import "server-only";
import { getSessionUser } from "@/lib/auth/session";
import { getAppContext, type AppContext } from "./context";

/**
 * The signed-in app context for a page that must render for everyone (the app host's 404, M5-20),
 * or null when there is none to show: signed out, an account with no page yet (the gate would send
 * it to /claim) or any failure reading it. `getAppContext` redirects a signed-out visitor to /login
 * and a pageless account to /claim, which is right for a screen and wrong for a 404: a 404 answers
 * with a page, so the redirect (and any other failure) reads as "no shell" here and the plain page
 * is drawn instead. The session is checked first, from verified claims, never a cookie's presence.
 */
export async function getAppContextIfSignedIn(): Promise<AppContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  try {
    return await getAppContext();
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    // A redirect is how the gate says "not here": nothing to log. Anything else is worth a line.
    if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) {
      console.error("[not-found] reading the app context failed", error);
    }
    return null;
  }
}
