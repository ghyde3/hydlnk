import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M13-07: `accounts.plan` is the EFFECTIVE plan, derived by the database (recompute_account_plan) from
 * `paid_plan` and an admin's gift. Nothing in the application may write it any more: the Stripe webhook
 * writes `paid_plan` through apply_subscription_state, a gift goes through admin_set_gift and
 * admin_end_gift, and a client cannot write either. This suite reads the source and fails when code
 * writes `plan` on the accounts table (src, scripts, edge functions and any migration after the gift
 * migration), or when the webhook or a gift reaches around those functions. Test fixtures are exempt:
 * they set a plan to set a scene (tests/e2e/fixtures write paid_plan).
 */

const ROOT = process.cwd();
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

function files(dir: string, pattern: RegExp): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, pattern));
    else if (pattern.test(name)) out.push(path);
  }
  return out;
}

const rel = (file: string) => relative(ROOT, file);
const code = [
  ...files(resolve(ROOT, "src"), /\.(ts|tsx)$/),
  ...files(resolve(ROOT, "scripts"), /\.(ts|tsx|js|mjs)$/),
  ...files(resolve(ROOT, "supabase/functions"), /\.(ts|js)$/),
];

/** The `accounts` call chains of a file: from `.from("accounts")` to the statement's end. */
function accountChains(source: string): string[] {
  const chains: string[] = [];
  for (const match of source.matchAll(/\.from\(\s*["'`]accounts["'`]\s*\)/g)) {
    const start = match.index ?? 0;
    const end = source.indexOf(";", start);
    chains.push(source.slice(start, end === -1 ? undefined : end));
  }
  return chains;
}

const WRITES_PLAN = /\.(update|upsert|insert)\(\s*(?:\[\s*)?\{[^}]*(?<![\w.])["']?plan["']?\s*:/;

describe("M13-07 nothing writes accounts.plan", () => {
  it("no source file updates, upserts or inserts `plan` on the accounts table", () => {
    for (const file of code) {
      for (const chain of accountChains(strip(readFileSync(file, "utf8")))) {
        expect(WRITES_PLAN.test(chain), `${rel(file)} writes accounts.plan:\n${chain}`).toBe(false);
      }
    }
  });

  it("the detector sees a direct write (so the test above can fail)", () => {
    expect(WRITES_PLAN.test('.from("accounts").update({ plan: "pro" }).eq("id", id)')).toBe(true);
    expect(
      WRITES_PLAN.test('.from("accounts").update({ stripe_customer_id: c, plan }).eq("id", id)'),
    ).toBe(false);
    expect(WRITES_PLAN.test('.from("accounts").update({ paid_plan: "pro" }).eq("id", id)')).toBe(
      false,
    );
    expect(WRITES_PLAN.test('.from("accounts").upsert({ id, plan: "free" })')).toBe(true);
  });

  it("no migration after the gift migration writes plan on accounts (SQL)", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const later = files(dir, /\.sql$/).filter((file) => file.split("/").pop()! > "20261013000002");
    for (const file of later) {
      const sql = readFileSync(file, "utf8")
        .replace(/--.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(
        /update\s+(?:public\.)?accounts\b[^;]*\bset\b[^;]*(?<![\w_])plan\s*=/i.test(sql),
        `${rel(file)} sets accounts.plan`,
      ).toBe(false);
    }
  });
});

describe("M13-07 the Stripe webhook writes the paid plan only, and a gift never calls Stripe", () => {
  const webhook = strip(readFileSync(resolve(ROOT, "src/lib/billing/webhook.ts"), "utf8"));

  it("the webhook changes the plan through apply_subscription_state and nowhere else", () => {
    expect(webhook).toContain('rpc("apply_subscription_state"');
    // Its only direct write to `accounts` is the Stripe customer id.
    const writes = accountChains(webhook).filter((chain) =>
      /\.(update|upsert|insert)\(/.test(chain),
    );
    for (const chain of writes)
      expect(chain).toMatch(/\.update\(\{ stripe_customer_id: customer \}\)/);
    expect(webhook).not.toMatch(/gift_|admin_set_gift|admin_end_gift/);
  });

  it("the checkout, portal and cancel code reads paid_plan, never the effective plan", () => {
    for (const name of ["checkout", "portal", "cancel", "account"]) {
      const source = strip(readFileSync(resolve(ROOT, `src/lib/billing/${name}.ts`), "utf8"));
      expect(source, `${name}.ts reads account.plan`).not.toMatch(/\baccount\.plan\b/);
    }
  });

  it("the gift actions never import or call Stripe and write through the two gift functions", () => {
    const source = strip(readFileSync(resolve(ROOT, "src/lib/billing/gift-actions.ts"), "utf8"));
    expect(source).not.toMatch(/stripe/i);
    expect(source).toContain('rpc("admin_set_gift"');
    expect(source).toContain('rpc("admin_end_gift"');
    expect(source).not.toMatch(/\.(update|upsert|insert|delete)\(\s*\{[^}]*plan/);
    // The gift screen and its form do not reach Stripe either.
    for (const path of [
      "src/lib/billing/gift-queries.ts",
      "src/lib/billing/gift-view.ts",
      "src/components/admin/gift-form.tsx",
      "src/app/(editor)/app/admin/accounts/[id]/gift/page.tsx",
    ]) {
      expect(readFileSync(resolve(ROOT, path), "utf8"), path).not.toMatch(
        /from "stripe"|billing\/stripe/,
      );
    }
  });
});
