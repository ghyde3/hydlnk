import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M19-12 (T6, T19): the static guard of the one access rule. It fails when
 *   1. a file outside the allowlist compares or filters on `owner_id` (`.eq("owner_id"`,
 *      `.eq("pages.owner_id"`, `.eq("site.owner_id"`, `owner_id ===`, `owner_id !==`,
 *      `.or(\`owner_id`), or an allowlisted file's count changes;
 *   2. a `p_owner_id:` argument is not `access.ownerId` or a value bound from it (listed);
 *   3. a secret-key user of pages, content_*, page_versions, site_paths or content_schedules imports
 *      neither the access helper (or a module built on it) nor is listed with its reason;
 *   4. a module that imports the access helper uses a cross-request cache, or the helper itself
 *      keeps state or caches;
 *   5. a migration after this wave creates a site-scoped policy that names owner_id without the
 *      access projections, outside the owner-only tables.
 * The allowlists are the owner-only (B) and owner-scoped (D) rows of the plan: file, count, reason.
 */

const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
const files = walk(join(ROOT, "src"))
  .map((file) => relative(ROOT, file))
  .filter((file) => !file.endsWith("database.types.ts"));
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const OWNER_COMPARISON = /\.eq\("(?:pages\.|site\.)?owner_id"|owner_id ===|owner_id !==|\.or\(`owner_id/g;

/** Rule 1: every owner_id comparison left in src, with why it is not a membership question. */
const OWNER_COMPARISONS: Readonly<Record<string, { count: number; reason: string }>> = {
  "src/lib/admin/account-queries.ts": { count: 2, reason: "admin: the account's own pages and grants (D11)" },
  "src/lib/admin/actions.ts": { count: 1, reason: "admin: expire an account's sites at suspension (D11)" },
  "src/lib/analytics/dashboard/source.ts": { count: 1, reason: "analytics are owner-only (B9, G3)" },
  "src/lib/auth/gate.ts": { count: 1, reason: "the user's OWN pages list (C1, T19); shared sites come from the rule" },
  "src/lib/billing/gift-queries.ts": { count: 1, reason: "billing is the account's own (B18)" },
  "src/lib/domains/core.ts": { count: 4, reason: "domains are owner-only (B6)" },
  "src/lib/editor/draft-write.ts": { count: 3, reason: "the MCP draft writer: MCP is owner-only (B16, M19-13)" },
  "src/lib/handles/claim.ts": { count: 1, reason: "claiming a handle: the account's own first site (B4)" },
  "src/lib/mcp/page-access.ts": { count: 15, reason: "MCP page access is owner-only (B11-B13, M19-13, G10)" },
  "src/lib/media/cleanup-admin.ts": { count: 3, reason: "the media queue of one owner folder (D6); callers pass access.ownerId" },
  "src/lib/pages/create-page-core.ts": { count: 2, reason: "creating a site counts the account's own sites (B3, HL001)" },
  "src/lib/pages/current.ts": { count: 2, reason: "own pages carry the owner filter; shared ones come from the gate (C3)" },
  "src/lib/pages/delete-account.ts": { count: 1, reason: "deleting an account deletes its own sites (B21, T19)" },
  "src/lib/pages/delete-page-core.ts": { count: 3, reason: "deleting a site is owner-only (B2)" },
  "src/lib/previews/core.ts": { count: 2, reason: "share links are owner-only (B8, G4)" },
  "src/lib/previews/shared.ts": { count: 1, reason: "a share link reads its site OWNER's themes (D7)" },
  "src/lib/publish/core.ts": { count: 1, reason: "themes of the site owner: ownerId is access.ownerId (D2)" },
  "src/lib/publish/invalidate.ts": { count: 1, reason: "expire all of an account's sites at suspension (B22)" },
  "src/lib/publish/unpublish.ts": { count: 1, reason: "unpublishing a site is owner-only (B1)" },
  "src/lib/themes/client.ts": { count: 2, reason: "a system theme flag, and the retry's scope to the site owner (C11, ownerId from access)" },
  "src/lib/themes/load.ts": { count: 2, reason: "system themes plus the site owner's (C11; ownerId is access.ownerId)" },
  "src/lib/versions/core.ts": { count: 2, reason: "the site owner's themes and draft write, bound from access.ownerId (A29, A30)" },
};

/** Rule 2: every `p_owner_id:` argument, as written, and why it is the site's owner. */
const P_OWNER_ID: Readonly<Record<string, { values: string[]; reason: string }>> = {
  "src/lib/content/publish-core.ts": { values: ["ready.access.ownerId", "ready.access.ownerId", "ready.access.ownerId"], reason: "the writer's access" },
  "src/lib/content/schedule-core.ts": { values: ["ready.access.ownerId", "ready.access.ownerId"], reason: "the writer's access" },
  "src/lib/content/trash-core.ts": { values: ["ready.access.ownerId", "ready.access.ownerId"], reason: "the writer's access" },
  "src/lib/site-pages/sub-pages-core.ts": { values: ["access.ownerId"], reason: "requireEntryAccess" },
  "src/lib/publish/core.ts": { values: ["ownerId", "ownerId"], reason: "const ownerId = access.ownerId / opened.site.ownerId (from access)" },
  "src/lib/content/site-page-publish-core.ts": { values: ["input.ownerId"], reason: "its one caller passes opened.site.ownerId (publish/core.ts)" },
  "src/lib/publish/unpublish.ts": { values: ["userId"], reason: "owner-only (B1): checked owner_id === userId above" },
};

/** Rule 3: modules that read site tables with the secret key without the helper, and why. */
const ACCESS_BACKED = /from "(?:@\/lib\/access(?:\/server)?|\.\/guards|@\/lib\/content(?:\/guards)?)"/;
const SITE_TABLE = /\.from\("(?:pages|content_[a-z_]+|page_versions|site_paths|content_schedules)"\)/;
const SECRET_KEY = /createAdminSupabase|SupabaseClient<Database>|type Admin\b|AdminClient|admin: /;
const SECRET_KEY_READERS: Readonly<Record<string, string>> = {
  "src/app/(tenant)/published-page.ts": "public reads: published only (D15)",
  "src/lib/access/index.ts": "the helper itself",
  "src/lib/admin/account-queries.ts": "admin (D11)",
  "src/lib/admin/draft-view.ts": "admin read-only draft view (D13)",
  "src/lib/admin/queries.ts": "admin (D11)",
  "src/lib/admin/suspension.ts": "is a page offline: published facts (D15)",
  "src/lib/analytics/dashboard/source.ts": "owner-only analytics (B9)",
  "src/lib/analytics/ingest/pages.ts": "analytics ingest: public (D15)",
  "src/lib/billing/gift-queries.ts": "billing (B18)",
  "src/lib/blog/published.ts": "public reads: published only (D15)",
  "src/lib/content/prune-terms.ts": "called by the writer after its access check",
  "src/lib/domains/page-handle.ts": "domains (B6)",
  "src/lib/handles/availability.ts": "handle availability: no site data",
  "src/lib/handles/claim-core.ts": "claiming a handle (B4)",
  "src/lib/handles/claim.ts": "claiming a handle (B4)",
  "src/lib/mcp/page-access.ts": "MCP, owner-only (B11-B13)",
  "src/lib/pages/create-page-core.ts": "creating a site (B3)",
  "src/lib/pages/delete-account.ts": "deleting the account (B21)",
  "src/lib/pages/delete-page-core.ts": "deleting a site (B2)",
  "src/lib/previews/core.ts": "share links (B8)",
  "src/lib/previews/shared.ts": "the share link page (D7)",
  "src/lib/publish/invalidate.ts": "suspension expiry (B22)",
  "src/lib/publish/link-rules.ts": "the page's hosts for the redirect rule; the gate checked access",
  "src/lib/publish/unpublish.ts": "unpublish, owner-only (B1)",
  "src/lib/reports/server.ts": "abuse reports: public pages (D15)",
  "src/lib/site/page-entries-core.ts": "read helpers called after an access check (or on published data)",
};

describe("M19-12 no check bypasses the one access helper", () => {
  it("M19-12 owner_id is compared only where the allowlist says, as many times as it says", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const count = (code(file).match(OWNER_COMPARISON) ?? []).length;
      if (count > 0) found[file] = count;
    }
    const want = Object.fromEntries(Object.entries(OWNER_COMPARISONS).map(([file, row]) => [file, row.count]));
    expect(found).toEqual(want);
  });

  it("M19-12 every p_owner_id is the site owner from the access helper (or a listed owner-only path)", () => {
    const found: Record<string, string[]> = {};
    for (const file of files) {
      const values = [...code(file).matchAll(/p_owner_id:\s*([^,}\n]+)/g)].map((m) => m[1]!.trim());
      if (values.length > 0) found[file] = values;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(P_OWNER_ID).map(([file, row]) => [file, row.values])));
  });

  it("M19-12 a secret-key reader of site tables asks the helper or is listed with its reason", () => {
    const bare = files.filter((file) => {
      const source = code(file);
      return SITE_TABLE.test(source) && SECRET_KEY.test(source) && !ACCESS_BACKED.test(source);
    });
    expect(bare.sort()).toEqual(Object.keys(SECRET_KEY_READERS).sort());
  });

  it("M19-12 access is never cached across requests (T6)", () => {
    for (const file of files) {
      const source = code(file);
      if (!/from "@\/lib\/access(?:\/server)?"/.test(source)) continue;
      expect(source, file).not.toMatch(/unstable_cache\(|["']use cache["']/);
    }
    for (const file of files.filter((f) => f.startsWith("src/lib/access/"))) {
      const source = code(file);
      expect(source, file).not.toMatch(/\bcache\(|unstable_cache|["']use cache["']/);
      expect(source, `${file} keeps no module-level state`).not.toMatch(/^(?:let|var) /m);
    }
  });

  it("M19-12 the owner-only screens and routes refuse a member, and the MCP rule is in decide()", () => {
    for (const file of [
      "src/app/(editor)/app/(screens)/analytics/page.tsx",
      "src/app/(editor)/app/(screens)/analytics/stats/route.ts",
      "src/app/(editor)/app/(screens)/analytics/export/route.ts",
      "src/app/(editor)/app/(screens)/audience/page.tsx",
      "src/app/(editor)/app/(screens)/audience/export/route.ts",
      "src/app/(editor)/app/(screens)/domains/page.tsx",
      "src/app/(editor)/app/(screens)/members/page.tsx",
      "src/lib/forms/audience-actions.ts",
    ]) {
      expect(code(file), file).toMatch(/current\.access\.isOwner/);
    }
    expect(code("src/lib/access/decide.ts")).toMatch(/if \(source === "mcp" && !row\.is_owner\) return "not_found";/);
  });
});

/** Rule 5: owner-only tables whose policies stay `owner_id = auth.uid()` (G20, byte-identical). */
const OWNER_ONLY_TABLES = [
  "accounts", "themes", "domains", "daily_stats", "daily_dim_stats", "daily_site_stats", "site_pages",
  "form_submissions",
];
const THIS_WAVE_LAST = "20261126220300";

describe("M19-12 new migrations keep site-scoped policies on the rule", () => {
  const dir = join(ROOT, "supabase/migrations");
  const migrations = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();

  it("M19-12 this wave's policy migration puts every site-scoped policy on accessible_site_ids", () => {
    const sql = readFileSync(join(dir, "20261126220200_site_access_policies.sql"), "utf8");
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+)([\s\S]*?);/g)];
    expect(policies.length).toBe(12);
    for (const [, name, , body] of policies) {
      expect(body, name).toMatch(/access\.(accessible_site_ids|readable_site_plans|shared_theme_owner_ids)\(/);
      expect(body, name).not.toMatch(/owner_id = \(select auth\.uid\(\)\)/);
    }
  });

  it("M19-12 a later migration's policy that names owner_id uses the rule or is on an owner-only table", () => {
    for (const name of migrations.filter((file) => file.slice(0, 14) > THIS_WAVE_LAST)) {
      const sql = readFileSync(join(dir, name), "utf8").toLowerCase();
      for (const [, policy, table, body] of sql.matchAll(/create policy (\w+) on public\.(\w+)([\s\S]*?);/g)) {
        if (!body!.includes("owner_id") || OWNER_ONLY_TABLES.includes(table!)) continue;
        expect(body, `${name}: ${policy}`).toMatch(/accessible_site_ids|readable_site_plans|shared_theme_owner_ids/);
      }
    }
  });
});
