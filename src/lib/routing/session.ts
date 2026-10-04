import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { SHARE_TOKEN_HEADER } from "@/lib/previews/share-headers";
import { setAppHeaders } from "./app-headers";
import { hostOnlyCookie } from "./cookies";

/**
 * Rewrites `request` to `destination` and refreshes the Supabase session on the way through.
 * Used for the app host only: it is the only host that carries auth cookies.
 *
 * Follows the @supabase/ssr proxy pattern: `getClaims()` runs before any response is returned, a
 * refreshed token is copied onto the request (so Server Components in this same request see it)
 * and onto the response (so the browser stores it), and the library's no-store cache headers ride
 * along so a CDN never caches a Set-Cookie response.
 *
 * The page never sees a client-chosen `x-hl-share-token`: that header is how `shareProxy` hands a
 * private link's token to its one internal route, after the rate limit, and nowhere else may carry
 * it (a second wall behind the proxy's refusal of the internal path itself). The headers are copied
 * on every `rewrite()` call, not once, because a refresh mutates `request.cookies` and rebuilds the
 * response from the request as it is by then.
 */
export async function rewriteWithSession(
  request: NextRequest,
  destination: URL,
): Promise<NextResponse> {
  const rewrite = () => {
    const headers = new Headers(request.headers);
    headers.delete(SHARE_TOKEN_HEADER);
    return NextResponse.rewrite(destination, { request: { headers } });
  };
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

  setAppHeaders(response.headers);
  return response;
}
