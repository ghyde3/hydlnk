import { z } from "zod";

/**
 * Shared pieces of the env validation. No `server-only` here: client.ts imports this file, and the
 * browser bundle needs it too. Nothing in this file may read a secret.
 */

/**
 * Root domain of the deployment: "localhost:3000" locally, "hydlnk.com" in production.
 * A bare host with an optional port: no scheme, no path, no trailing slash.
 */
export const rootDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/, {
    error: 'Expected a host such as "localhost:3000" or "hydlnk.com", without scheme or path',
  });

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "Expected the Supabase project URL" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_ROOT_DOMAIN: rootDomainSchema,
});

/**
 * Reads the public variables. Every `process.env.NEXT_PUBLIC_*` reference is written out in full on
 * purpose: Next.js inlines them into the client bundle by static text replacement, so a dynamic
 * lookup like `process.env[name]` would be undefined in the browser.
 */
export function readPublicEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
  };
}

/**
 * Parses `source` with `schema` and throws one error that names every missing or invalid variable.
 * Values are never echoed, so a malformed secret cannot end up in a log. An empty string counts as
 * unset (Vercel and dotenv both produce them).
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined>,
  scope: "client" | "server",
): z.output<Schema> {
  const cleaned: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(source)) {
    cleaned[name] = value === "" ? undefined : value;
  }

  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const missing = new Set<string>();
  const invalid: string[] = [];
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? "(unknown)");
    if (cleaned[name] === undefined) missing.add(name);
    else invalid.push(`${name} (${issue.message})`);
  }

  const lines = [`Invalid ${scope} environment variables.`];
  if (missing.size > 0) lines.push(`  Missing: ${[...missing].join(", ")}`);
  if (invalid.length > 0) lines.push(`  Invalid: ${invalid.join("; ")}`);
  lines.push(
    "Local values are written to .env.local by scripts/init.sh. Production values live in the Vercel project settings. See .env.example.",
  );
  throw new Error(lines.join("\n"));
}
