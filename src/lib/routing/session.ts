import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { hostOnlyCookie } from "./cookies";

/**
 * Rewrites `request` to `destination` and refreshes the Supabase session on the way through.
 * Used for the app host only: it is the only host that carries auth cookies.
 *
 * Follows the @supabase/ssr proxy pattern: `getClaims()` runs before any response is returned, a
 * refreshed token is copied onto the request (so Server Components in this same request see it)
 * and onto the response (so the browser stores it), and the library's no-store cache headers ride
 * along so a CDN never caches a Set-Cookie response.
 */
export async function rewriteWithSession(
  request: NextRequest,
  destination: URL,
): Promise<NextResponse> {
  const rewrite = () =>
    NextResponse.rewrite(destination, { request: { headers: request.headers } });
  let response = rewrite();

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = rewrite();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, hostOnlyCookie(options));
          }
          for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        },
      },
    },
  );

  try {
    await supabase.auth.getClaims();
  } catch (error) {
    // An unreachable Supabase must not take the whole app host down; pages that need a session
    // check it themselves.
    console.error("[proxy] session refresh failed", error);
  }

  // Everything the app host serves depends on the session cookie: never stored by a browser
  // (back button after sign-out) or a shared cache (M1-07).
  response.headers.set("Cache-Control", "no-store");
  // The app host holds Sign out, Delete account and the claim form: never inside someone else's frame.
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}
