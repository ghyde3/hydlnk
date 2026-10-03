import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { clientEnv } from "@/lib/env/client";
import { checkHandle } from "@/lib/handles/availability";
import { accountHasPage } from "@/lib/handles/claim";
import { CHECK_UNAVAILABLE_MESSAGE } from "@/lib/handles/form-state";
import { PENDING_HANDLE_COOKIE, PENDING_HANDLE_MAX_AGE_SECONDS } from "@/lib/handles/pending";
import { appOrigin, protocolFor } from "@/lib/routing/urls";
import { createServerSupabase } from "@/lib/supabase/server";
import { ensureAccount } from "./accounts";
import {
  GOOGLE_EXPIRED_MESSAGE,
  GOOGLE_FAILED_MESSAGE,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_NONCE_MAX_AGE_SECONDS,
  GOOGLE_RATE_LIMITED_MESSAGE,
  type GoogleNonceResult,
  type GoogleSignInResult,
} from "./google-shared";

/*
 * Server side of "Sign in with Google" (Google Identity Services). The Server Actions in
 * google-actions.ts are thin wrappers around the two functions here, so this file can be tested
 * without the Next.js action machinery. See google-shared.ts for the whole flow.
 *
 * What this file guarantees:
 *   - Same-origin only: the Origin header must be exactly the app origin. Browsers always send it
 *     on a POST, so a missing or foreign one is refused (CSRF, on top of Next.js's own check).
 *   - The RAW nonce lives only in an httpOnly host-only cookie and is read from there, never from
 *     the request body. It is single use: cleared on every sign-in attempt, successful or not.
 *   - The token's `nonce` claim must be sha256(raw nonce) BEFORE Supabase is asked anything. Supabase
 *     checks it too, but only while its "Skip nonce checks" switch is off; this keeps the replay
 *     protection independent of that setting. Reading the claim without verifying the signature is
 *     safe because Supabase verifies the signature of the very same token.
 *   - A handle chosen on /signup is validated here (rules, reserved, taken) before any sign-in
 *     and travels on in the same short-lived cookie the old redirect flow used, set only after the
 *     sign-in has worked and only when the account has no page yet.
 */

/** A JWT is three base64url segments. Google's ID tokens are about 1 KB; 6000 is generous. */
const MAX_CREDENTIAL_LENGTH = 6000;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
/** randomBytes(32) as base64url. Anything else in the cookie is not ours. */
const RAW_NONCE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const hashNonce = (raw: string): string => createHash("sha256").update(raw).digest("hex");

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function isSameOrigin(): Promise<boolean> {
  const origin = (await headers()).get("origin");
  return origin !== null && origin === appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
}

/** The cookie options shared by setting and clearing: host-only (no `domain`), Lax, httpOnly. */
function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: protocolFor(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN) === "https",
    path: "/",
    maxAge,
  };
}

/** The claims of a JWT, read WITHOUT checking its signature. Null when it is not a JWT. */
export function readIdTokenClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** True when the token was issued for this app's own Google client (`aud`). */
function audienceMatches(claims: Record<string, unknown>, clientId: string): boolean {
  const { aud } = claims;
  return aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
}

/**
 * Step 1: a fresh raw nonce into the cookie, its SHA-256 (hex) back to the page for GIS. Called on
 * every mount of the button and again after every attempt, since an attempt spends the nonce.
 */
export async function issueGoogleNonce(): Promise<GoogleNonceResult> {
  if (!clientEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return { ok: false };
  if (!(await isSameOrigin())) return { ok: false };

  const raw = randomBytes(32).toString("base64url");
  (await cookies()).set(GOOGLE_NONCE_COOKIE, raw, cookieOptions(GOOGLE_NONCE_MAX_AGE_SECONDS));
  return { ok: true, nonce: hashNonce(raw) };
}

/**
 * Whether the account may take a pending handle, and the cookie work that follows. A handle chosen
 * on /signup rides to /claim in a cookie; an account that already has a page never claims another,
 * so a stale cookie is dropped here instead of lingering for its 15 minutes (as /auth/callback does
 * for the redirect flow).
 */
async function carryPendingHandle(userId: string, handle: string | null): Promise<void> {
  const cookieStore = await cookies();
  try {
    if (await accountHasPage(userId)) {
      cookieStore.delete(PENDING_HANDLE_COOKIE);
      return;
    }
  } catch (error) {
    // Without the lookup, err on the side of not carrying anything.
    console.error("[auth] page lookup failed after Google sign-in", error);
    return;
  }
  if (handle !== null) {
    cookieStore.set(PENDING_HANDLE_COOKIE, handle, cookieOptions(PENDING_HANDLE_MAX_AGE_SECONDS));
  }
}

const failure = (message: string): GoogleSignInResult => ({ kind: "error", message });

/**
 * Step 4: turns a Google ID token into a Supabase session. On success the session cookies are on
 * this response and it returns `{ kind: "ok" }`; the page then loads "/", where the auth gate
 * routes onward (/claim, which resumes the pending handle, or /editor). Navigation is the page's
 * job, not a redirect from the action, so the browser starts that load with the new cookies and
 * no stale client-side router cache from the signed-out screens.
 *
 * `handle` is given on /signup (an empty string counts as given, and is refused as too short) and
 * left out on /login.
 */
export async function completeGoogleSignIn(input: {
  credential: unknown;
  handle?: unknown;
}): Promise<GoogleSignInResult> {
  const clientId = clientEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId || !(await isSameOrigin())) return failure(GOOGLE_FAILED_MESSAGE);

  // The nonce is spent by this attempt, whatever happens next.
  const cookieStore = await cookies();
  const rawNonce = cookieStore.get(GOOGLE_NONCE_COOKIE)?.value;
  cookieStore.delete(GOOGLE_NONCE_COOKIE);
  if (!rawNonce || !RAW_NONCE_SHAPE.test(rawNonce)) return failure(GOOGLE_EXPIRED_MESSAGE);

  const { credential } = input;
  if (
    typeof credential !== "string" ||
    credential.length > MAX_CREDENTIAL_LENGTH ||
    !JWT_SHAPE.test(credential)
  ) {
    return failure(GOOGLE_FAILED_MESSAGE);
  }

  const claims = readIdTokenClaims(credential);
  if (!claims || typeof claims.nonce !== "string") return failure(GOOGLE_FAILED_MESSAGE);
  if (!constantTimeEqual(claims.nonce, hashNonce(rawNonce))) {
    return failure(GOOGLE_EXPIRED_MESSAGE);
  }
  if (!audienceMatches(claims, clientId)) return failure(GOOGLE_FAILED_MESSAGE);

  // The handle is judged before anyone is signed in: a name that can't be claimed never costs an
  // account, and a direct call with handle=www leaves no session and no cookie (M1-13).
  let handle: string | null = null;
  if (input.handle !== undefined && input.handle !== null) {
    if (typeof input.handle !== "string") return failure(GOOGLE_FAILED_MESSAGE);
    try {
      const checked = await checkHandle(input.handle);
      if (checked.status !== "available") {
        return { kind: "handle", handle: checked.handle, status: checked.status };
      }
      handle = checked.handle;
    } catch (error) {
      console.error("[auth] handle check before Google sign-in failed", error);
      return failure(CHECK_UNAVAILABLE_MESSAGE);
    }
  }

  let userId: string;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: credential,
      nonce: rawNonce,
    });
    if (error || !data.user) {
      // Only the code and status are logged: the message can quote token details.
      console.error("[auth] Google sign-in refused", error?.code ?? error?.status);
      return failure(
        error?.status === 429 || error?.code === "over_request_rate_limit"
          ? GOOGLE_RATE_LIMITED_MESSAGE
          : GOOGLE_FAILED_MESSAGE,
      );
    }
    userId = data.user.id;
  } catch (error) {
    console.error("[auth] Google sign-in threw", error instanceof Error ? error.name : "unknown");
    return failure(GOOGLE_FAILED_MESSAGE);
  }

  try {
    // The database trigger already made the row; this covers a missing one (as /auth/callback does).
    await ensureAccount(userId);
  } catch (error) {
    // Signing in worked; requireUser() retries the self-heal on the next page load.
    console.error("[auth] ensureAccount failed after Google sign-in", error);
  }

  await carryPendingHandle(userId, handle);
  return { kind: "ok" };
}
