import { z } from "zod";

/**
 * The two environment variables the admin area adds (M5-04, M5-09), parsed from a plain source
 * object so a unit test can feed any value and the app can feed `process.env`. No `server-only`
 * and no `process.env` read at import time.
 *
 *   ADMIN_USER_IDS  comma-separated auth user UUIDs, optional. Empty or unset means nobody is an
 *                   admin. Admin identity is this list matched against the verified session
 *                   (`getClaims()`), never a request field.
 *   SUPPORT_EMAIL   where a suspended owner is told to write; defaults to support@hydlnk.com.
 *
 * The shared server env schema (`src/lib/env/server-schema.ts`) takes `adminUserIdsSchema` and
 * `supportEmailSchema` for the two keys, so a typo fails startup naming the variable. The runtime
 * readers below are lenient on purpose: they never throw and never admit an entry they cannot
 * read as a UUID.
 */

export const DEFAULT_SUPPORT_EMAIL = "support@hydlnk.com";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The entries of an ADMIN_USER_IDS value: lower-cased UUIDs, and the entries that are not one. */
export function splitAdminUserIds(raw: string | undefined): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const entry = part.trim();
    if (entry === "") continue;
    const lower = entry.toLowerCase();
    if (UUID_RE.test(lower)) ids.push(lower);
    else invalid.push(entry);
  }
  return { ids: [...new Set(ids)], invalid };
}

/** Startup validation: every non-empty entry must be a UUID. The message never holds a value. */
export const adminUserIdsSchema = z
  .string()
  .optional()
  .superRefine((raw, ctx) => {
    const { invalid } = splitAdminUserIds(raw);
    if (invalid.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${invalid.length} entr${invalid.length === 1 ? "y is" : "ies are"} not a UUID; expected comma-separated auth user ids`,
      });
    }
  });

export const supportEmailSchema = z.email().default(DEFAULT_SUPPORT_EMAIL);

/** The admin allowlist from a source object (`process.env`, or a test's). Invalid entries are dropped. */
export function readAdminUserIds(
  source: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  return new Set(splitAdminUserIds(source.ADMIN_USER_IDS).ids);
}

/** The support address from a source object; an unset, empty or malformed value is the default. */
export function readSupportEmail(source: Record<string, string | undefined> = process.env): string {
  const parsed = supportEmailSchema.safeParse(source.SUPPORT_EMAIL?.trim() || undefined);
  return parsed.success ? parsed.data : DEFAULT_SUPPORT_EMAIL;
}

/**
 * True only when this deployment's root domain is a localhost one ("localhost:3000"): local
 * development, CI and the Playwright suite. Production runs on hydlnk.com, so the local-only
 * admin marker below can never be honoured there, whatever the claims say.
 */
export function isLocalRootDomain(rootDomain: string | undefined): boolean {
  const hostname = (rootDomain ?? "").trim().toLowerCase().split(":")[0] ?? "";
  return hostname === "localhost" || hostname.endsWith(".localhost");
}
