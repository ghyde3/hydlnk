import { z } from "zod";

/**
 * The four optional Sentry variables (M9-10), in one file of their own. They are deliberately not in
 * shared.ts or server-schema.ts: shared.ts is bundled into every client chunk that reads the
 * environment, so a DSN read there would be inlined into the marketing site's JavaScript too, and the
 * build-only token has no business in a schema the whole server imports. The DSN is read, spelled
 * out in full, by exactly two files: the app host's layout component and src/instrumentation.ts.
 *
 *   NEXT_PUBLIC_SENTRY_DSN  public by design, inlined at build. Sentry is off unless it holds a usable
 *                           https DSN (src/lib/sentry/dsn.ts). Permissive here: a value that is not
 *                           one is ignored with one log line, it never stops the app.
 *   SENTRY_AUTH_TOKEN       secret, BUILD only (next.config.ts): uploads source maps. Never in the app.
 *   SENTRY_ORG, SENTRY_PROJECT
 *                           the Sentry organisation and project slugs, build only.
 *
 * All four are optional. Source maps are uploaded only when the last three are all set.
 */

const optionalText = z
  .string()
  .optional()
  // An empty or blank value (Vercel and dotenv both produce them) reads as unset.
  .transform((value) => value?.trim() || undefined);

export const sentryEnvSchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: optionalText,
  SENTRY_AUTH_TOKEN: optionalText,
  SENTRY_ORG: optionalText,
  SENTRY_PROJECT: optionalText,
});

export type SentryEnv = z.output<typeof sentryEnvSchema>;

export const SENTRY_ENV_KEYS = ["NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"] as const;

/** Parses the four from any source (`process.env`, or a test's own). Never throws for a missing or odd value. */
export function parseSentryEnv(source: Record<string, string | undefined>): SentryEnv {
  return sentryEnvSchema.parse({
    NEXT_PUBLIC_SENTRY_DSN: source.NEXT_PUBLIC_SENTRY_DSN,
    SENTRY_AUTH_TOKEN: source.SENTRY_AUTH_TOKEN,
    SENTRY_ORG: source.SENTRY_ORG,
    SENTRY_PROJECT: source.SENTRY_PROJECT,
  });
}
