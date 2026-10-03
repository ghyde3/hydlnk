import type { HandleStatus } from "@/lib/handles/status";

/**
 * Shared pieces of Google sign-in (Google Identity Services, GIS). No `server-only` here: the
 * button imports the types and the tests import the constants. Nothing in this file is secret.
 *
 * The flow, end to end:
 *   1. The page asks the server for a nonce (`prepareGoogleSignIn`). The server keeps the RAW nonce
 *      in a short-lived httpOnly cookie and hands the browser only sha256(raw).
 *   2. GIS is initialised with that hash. Google puts it, verbatim, into the ID token's `nonce`.
 *   3. The user picks an account in Google's own button/popup; the browser gets an ID token.
 *   4. The token goes to `signInWithGoogle`, a Server Action. The server reads the raw nonce from
 *      the cookie (never from the request), checks it against the token, and Supabase verifies the
 *      signature, audience and expiry (`signInWithIdToken`) and sets the session cookies.
 */

/** Holds the raw nonce between the page load and the sign-in. httpOnly, host-only, SameSite=Lax. */
export const GOOGLE_NONCE_COOKIE = "hl-google-nonce";
/** 15 minutes: long enough to sit on the page, short enough to go stale. */
export const GOOGLE_NONCE_MAX_AGE_SECONDS = 900;

/** Google's client library. Loaded only on the sign-in screens, never on any other page. */
export const GOOGLE_GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";

/**
 * The hosts Google documents for a Content Security Policy around GIS. The app host's policy sets
 * no `script-src`, `connect-src`, `style-src` or `frame-src` today, so nothing blocks these; the
 * values are kept here so a stricter policy has one place to take them from (see app-headers.ts).
 */
export const GOOGLE_GSI_CSP_SOURCES = {
  script: "https://accounts.google.com/gsi/client",
  frame: "https://accounts.google.com/gsi/",
  connect: "https://accounts.google.com/gsi/",
  style: "https://accounts.google.com/gsi/style",
} as const;

export const GOOGLE_FAILED_MESSAGE = "Google sign-in didn’t work. Try again or use an email link.";
export const GOOGLE_EXPIRED_MESSAGE = "Google sign-in expired. Try again.";
export const GOOGLE_RATE_LIMITED_MESSAGE = "Too many attempts. Try again in a minute.";
export const GOOGLE_UNAVAILABLE_MESSAGE =
  "Google sign-in couldn’t load. Use an email link instead.";

/**
 * What `prepareGoogleSignIn` returns. `nonce` is sha256(raw nonce), hex: the value GIS is
 * initialised with. `ok: false` means sign-in with Google is not available here (not configured,
 * or a cross-origin caller).
 */
export type GoogleNonceResult = { ok: true; nonce: string } | { ok: false };

/**
 * What `signInWithGoogle` returns. The nonce is spent on every call, so after anything but `ok`
 * the caller must ask for a new one before the next attempt.
 *
 *   ok      signed in: the session cookies are on this response, load "/" next
 *   error   anything the user can only retry (expired, refused by Google/Supabase, rate limit)
 *   handle  signup only: the chosen handle can't be used (taken, reserved, malformed...). Nothing
 *           was signed in and no cookie was set.
 */
export type GoogleSignInResult =
  | { kind: "ok" }
  | { kind: "error"; message: string }
  | { kind: "handle"; handle: string; status: HandleStatus };
