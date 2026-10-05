import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M11-11 step 1: the app says "site" for the whole thing (the address, the domain, the QR code, the
 * analytics, the sign-up) and "page" only for Home and a sub-page. These copy modules speak about the
 * whole site, so "your page", "a page" and "one of your pages" must not creep back into their words.
 * (Comments are not copy and are skipped.)
 */

const MODULES = [
  "src/lib/domains/messages.ts",
  "src/components/domains/view-model.ts",
  "src/components/domains/domain-card.tsx",
  "src/components/domains/studio-upsell.tsx",
  "src/app/(editor)/app/(screens)/domains/page.tsx",
  "src/app/(editor)/app/signup/page.tsx",
  "src/components/auth/login-form.tsx",
  "src/components/workspace/share/qr-card.tsx",
  "src/components/workspace/share/link-tracking-card.tsx",
  "src/components/analytics/states.tsx",
  "src/components/analytics/export-row.tsx",
  "src/emails/domain-live.tsx",
];

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");
// "Reload the page" and "not-found page" are about the browser's or the 404's page, not the site.
const ALLOWED = /reload the page|not-found page/i;
const STALE = /\b(your|a|that|this|one of your) pages?\b|\byour pages\b/i;

describe("M11-11 site wording in the copy modules", () => {
  it.each(MODULES)("%s never calls the whole site a page", (path) => {
    const source = code(readFileSync(resolve(process.cwd(), path), "utf8"));
    const literals = [
      ...source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}\n]+)</g),
    ].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
    const stale = literals
      .map((text) => text.replace(ALLOWED, ""))
      .filter((text) => STALE.test(text));
    expect(stale).toEqual([]);
  });
});
