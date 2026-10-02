import { normalizeHandle } from "@/lib/handles/rules";
import { appOrigin } from "@/lib/routing/urls";

/**
 * The hand-off from the landing page to sign-up: <app origin>/signup?handle=<normalized handle>.
 * One function builds the destination for both claim forms and the nav link, so they cannot drift.
 * The handle is normalized with the shared rules (src/lib/handles/rules.ts), the same function the
 * signup page applies, so a no-JavaScript submit and a JavaScript one arrive at the same value.
 * Kept free of `@/lib/env/client` so it can be unit tested without the public env.
 */

/** http://app.localhost:3000/signup or https://app.hydlnk.com/signup, with the handle when given. */
export function signupUrl(rootDomain: string, rawHandle = ""): string {
  const url = new URL("/signup", appOrigin(rootDomain));
  const handle = normalizeHandle(rawHandle);
  if (handle) url.searchParams.set("handle", handle);
  return url.toString();
}
