import { GOOGLE_GSI_CSP_SOURCES } from "@/lib/auth/google-shared";

/**
 * Security headers of an app-host response (app.<root>): the editor, sign-in and everything else
 * that carries auth cookies. Set by rewriteWithSession on the app host only; marketing and tenant
 * hosts never get them (tenants have their own, tenant-headers.ts).
 *
 * The Content-Security-Policy is deliberately small: it forbids framing the app host and nothing
 * else. It sets no `default-src`, `script-src`, `style-src`, `connect-src` or `frame-src`, because a
 * policy with those needs per-request nonces for Next.js's inline scripts (and `unsafe-eval` in
 * development) and has to list every origin the editor talks to (Supabase, fonts, YouTube and
 * Spotify embeds in the preview). That hardening is its own piece of work.
 *
 * What that means for "Sign in with Google" (Google Identity Services): nothing is blocked today,
 * so the button, its iframe and its popup work. `buildContentSecurityPolicy` is the single place
 * that keeps it that way: when a directive Google documents (script-src, frame-src, connect-src,
 * style-src, default-src) is ever added to APP_DIRECTIVES, Google's origin is added to it
 * automatically.
 *
 * No Cross-Origin-Opener-Policy is set on purpose. The popup mode needs `unsafe-none` (the
 * default) or `same-origin-allow-popups`; `same-origin` would leave Google's popup blank.
 */
export const APP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  // The app host holds Sign out, Delete account and the claim form: never inside someone else's frame.
  "frame-ancestors": ["'none'"],
};

/** The origin Google documents for each directive: https://developers.google.com/identity/gsi/web */
const GIS_SOURCE_FOR: Readonly<Record<string, string>> = {
  "script-src": GOOGLE_GSI_CSP_SOURCES.script,
  "frame-src": GOOGLE_GSI_CSP_SOURCES.frame,
  "connect-src": GOOGLE_GSI_CSP_SOURCES.connect,
  "style-src": GOOGLE_GSI_CSP_SOURCES.style,
  "default-src": GOOGLE_GSI_CSP_SOURCES.frame,
};

/** Joins directives into a policy, adding Google's origin to every directive that needs it. */
export function buildContentSecurityPolicy(
  directives: Readonly<Record<string, readonly string[]>>,
): string {
  return Object.entries(directives)
    .map(([name, sources]) => {
      const google = GIS_SOURCE_FOR[name];
      const all = google && !sources.includes(google) ? [...sources, google] : sources;
      return [name, ...all].join(" ");
    })
    .join("; ");
}

export const APP_CONTENT_SECURITY_POLICY = buildContentSecurityPolicy(APP_DIRECTIVES);

export function setAppHeaders(headers: Headers): void {
  // Everything the app host serves depends on the session cookie: never stored by a browser
  // (back button after sign-out) or a shared cache (M1-07).
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", APP_CONTENT_SECURITY_POLICY);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}
