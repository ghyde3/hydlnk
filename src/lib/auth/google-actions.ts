"use server";

import { completeGoogleSignIn, issueGoogleNonce } from "./google";
import type { GoogleNonceResult, GoogleSignInResult } from "./google-shared";

/*
 * Server Actions behind the "Sign in with Google" button. A Server Action is always a POST and
 * Next.js already refuses one whose Origin differs from the Host; google.ts checks the Origin
 * against the app origin as well. Everything that matters is in google.ts.
 */

/** Gives the page a nonce for GIS (sha256 of a server-kept random value). See issueGoogleNonce. */
export async function prepareGoogleSignIn(): Promise<GoogleNonceResult> {
  return issueGoogleNonce();
}

/**
 * Signs in with the ID token Google's button returned. `handle` is the handle chosen on /signup
 * (omitted on /login). See completeGoogleSignIn.
 */
export async function signInWithGoogle(input: {
  credential: string;
  handle?: string;
}): Promise<GoogleSignInResult> {
  return completeGoogleSignIn({ credential: input?.credential, handle: input?.handle });
}
