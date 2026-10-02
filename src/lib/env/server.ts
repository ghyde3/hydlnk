import "server-only";
import {
  M4_REQUIRED_KEYS,
  parseServerEnv,
  readServerEnvSource,
  type M4RequiredKey,
  type ServerEnv,
} from "./server-schema";

export { M4_REQUIRED_KEYS };
export type { M4RequiredKey, ServerEnv };

/**
 * Every server and public variable, validated when this module is first imported.
 * `server-only` makes importing it from a Client Component a build error.
 *
 * The nine Milestone 4 variables (Vercel API, Stripe price ids, cron and visitor-hash secrets) are
 * required whenever VERCEL_ENV is set, i.e. on every Vercel build and deployment, so a missing one
 * stops the build with a message that names it. Off Vercel (a local `next dev`, CI) they may be
 * unset until the feature that reads them runs; read them with `requireServerEnv`, which throws
 * the same kind of error at the point of use. `STRIPE_SECRET_KEY` is always sandbox-only (a live
 * key fails validation), and `STRIPE_API_HOST` / `VERCEL_API_BASE_URL` (test-only redirects to a
 * local stub) fail validation when VERCEL_ENV=production. Values never appear in an error.
 */
export const serverEnv: ServerEnv = parseServerEnv(readServerEnvSource(), {
  requireM4: Boolean(process.env.VERCEL_ENV),
});

/** A Milestone 4 variable that must be present where it is used; throws naming it when it is not. */
export function requireServerEnv(name: M4RequiredKey): string {
  const value = serverEnv[name];
  if (!value) {
    throw new Error(
      `Missing server environment variable ${name}. Local values are written to .env.local by scripts/init.sh; production values live in the Vercel project settings. See .env.example.`,
    );
  }
  return value;
}
