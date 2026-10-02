import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvLocal } from "./publish-support";

/**
 * M2-22: after `pnpm build`, the client bundle holds no secret key. Scans `.next/static` (or the
 * `.next` of HL_BUILD_DIR when the build lives elsewhere) and is skipped when there is no build.
 *
 * What counts as a leak: the variable name SUPABASE_SECRET_KEY, any `sb_secret_` followed by key
 * material (20 or more key characters), and the local secret key itself. The bare prefix
 * `sb_secret_` is not a leak: supabase-js ships it in its own `startsWith("sb_secret_")` guard that
 * refuses a secret key in a browser, so a literal grep for the prefix finds the library, not a key.
 *
 * M4-01 step 5 extends it to the Milestone 4 secrets: the value of every one of STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, VERCEL_API_TOKEN, CRON_SECRET and VISITOR_HASH_SECRET that is set (the
 * local placeholders from scripts/lib/local-env-placeholders.sh count), and any Stripe key or
 * signing-secret shaped string (`sk_`/`rk_` test or live, `whsec_`) followed by key material.
 */

const staticDir = join(resolve(process.env.HL_BUILD_DIR ?? join(process.cwd(), ".next")), "static");
const haveBuild = existsSync(staticDir);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(js|css|map|json|html|txt)$/.test(name)) out.push(path);
  }
  return out;
}

describe.skipIf(!haveBuild)("M2-22 the client bundle holds no secret key", () => {
  const texts = haveBuild
    ? files(staticDir).map((path) => ({ path, text: readFileSync(path, "utf8") }))
    : [];

  it("scanned something", () => {
    expect(texts.length).toBeGreaterThan(0);
  });

  it("no SUPABASE_SECRET_KEY and no sb_secret_ key material in .next/static", () => {
    const offenders = texts
      .filter(({ text }) => /SUPABASE_SECRET_KEY|sb_secret_[A-Za-z0-9_-]{20,}/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("not even the local secret key itself", () => {
    loadEnvLocal();
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return;
    const offenders = texts.filter(({ text }) => text.includes(secret)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("M4-01: no Stripe, Vercel, cron or visitor-hash secret value, and nothing shaped like one", () => {
    loadEnvLocal();
    const names = [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "VERCEL_API_TOKEN",
      "CRON_SECRET",
      "VISITOR_HASH_SECRET",
    ];
    const values = names
      .map((name) => process.env[name])
      .filter((value): value is string => typeof value === "string" && value.length >= 8);
    const shaped = /\b(?:[sr]k_(?:live|test)_|whsec_)[A-Za-z0-9_]{16,}/;
    const offenders = texts
      .filter(({ text }) => shaped.test(text) || values.some((value) => text.includes(value)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
