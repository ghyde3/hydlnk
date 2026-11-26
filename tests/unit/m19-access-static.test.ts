import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_ONLY_TABLES } from "@/lib/access/owner-only";

/**
 * M19-12 (T6, T19, S5): the static guard of the one access rule. It fails when
 *   1. a file compares or filters on `owner_id` (`.eq/.neq/.filter/.in/.is/.not("owner_id"`, any
 *      quote, any `table.` prefix; `.match({ owner_id })`; `owner_id ===`/`!==` and the reverse, with
 *      or without spaces; `.or("owner_id…`) other than as the allowlist says: file, pattern, count;
 *   2. a `p_owner_id` argument is not `access.ownerId` or a value bound from it (listed), including
 *      the shorthand `{ p_owner_id }`, and an `.rpc(..., { ...spread })` that could carry one;
 *   3. a secret-key user of pages, content_*, page_versions, site_paths or content_schedules (any
 *      quote, template literals too) or of an rpc taking `p_site_id`/`p_page_id` does not CALL an
 *      access helper (`require*Access(`, `siteFor(`, `entryFor(`, `termFor(`, `siteAccessFor(`) and
 *      is not listed with its reason (importing one, or `import type`, is not enough);
 *   4. a module that imports the access helper (index, server or decide) uses a cross-request cache,
 *      or the helper itself keeps state or caches;
 *   5. a migration after this wave creates a site-scoped policy that names owner_id without the
 *      access projections, outside the owner-only tables, whose ONE list is OWNER_ONLY_TABLES
 *      (src/lib/access/owner-only.ts), equal to the database's access.owner_only_tables().
 * The allowlists are the owner-only (B) and owner-scoped (D) rows of the plan. The S5 block below
 * feeds a throwaway file in each form of a bypass to the same scan and expects it caught.
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
/** The code of a file: comments out, `import type` statements out (a type import grants nothing). */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*import\s+type\b[\s\S]*?;[ \t]*$/gm, "");

const Q = "[\"'`]";
/** Rule 1's patterns, by name (the allowlist's pattern column). */
const OWNER_PATTERNS = {
  filter: new RegExp(`\\.(?:eq|neq|filter|in|is|not)\\(\\s*${Q}(?:[a-z_]+\\.)?owner_id${Q}`, "g"),
  match: /\.match\(\s*\{[^}]*\bowner_id\b/g,
  compare: /\bowner_id\s*[!=]==|[!=]==\s*[\w.?]*\bowner_id\b/g,
  or: new RegExp(`\\.or\\(\\s*${Q}[^"'\`]*owner_id`, "g"),
} as const;

type OwnerRow = { file: string; pattern: keyof typeof OWNER_PATTERNS; count: number; reason: string };
/** Rule 1: every owner_id comparison left in src, with why it is not a membership question. */
const OWNER_COMPARISONS: readonly OwnerRow[] = [
  { file: "src/lib/admin/account-queries.ts", pattern: "filter", count: 2, reason: "admin: the account's own pages and grants (D11)" },
  { file: "src/lib/admin/actions.ts", pattern: "filter", count: 1, reason: "admin: expire an account's sites at suspension (D11)" },
  { file: "src/lib/admin/queries.ts", pattern: "filter", count: 1, reason: "admin: the reported pages' owners and their other pages (D11)" },
  { file: "src/lib/analytics/dashboard/source.ts", pattern: "filter", count: 1, reason: "analytics are owner-only (B9, G3)" },
  { file: "src/lib/auth/gate.ts", pattern: "filter", count: 1, reason: "the user's OWN pages list (C1, T19); shared sites come from the rule" },
  { file: "src/lib/billing/gift-queries.ts", pattern: "filter", count: 1, reason: "billing is the account's own (B18)" },
  { file: "src/lib/domains/core.ts", pattern: "compare", count: 2, reason: "domains are owner-only (B6)" },
  { file: "src/lib/domains/core.ts", pattern: "filter", count: 2, reason: "domains are owner-only (B6)" },
  { file: "src/lib/editor/draft-write.ts", pattern: "compare", count: 1, reason: "the MCP draft writer: MCP is owner-only (B16, M19-13)" },
  { file: "src/lib/editor/draft-write.ts", pattern: "filter", count: 2, reason: "the MCP draft writer: MCP is owner-only (B16, M19-13)" },
  { file: "src/lib/handles/claim.ts", pattern: "filter", count: 1, reason: "claiming a handle: the account's own first site (B4)" },
  { file: "src/lib/mcp/page-access.ts", pattern: "compare", count: 6, reason: "MCP page access is owner-only (B11-B13, M19-13, G10)" },
  { file: "src/lib/mcp/page-access.ts", pattern: "filter", count: 7, reason: "MCP page access is owner-only (B11-B13, M19-13, G10)" },
  { file: "src/lib/mcp/page-access.ts", pattern: "or", count: 2, reason: "MCP page access is owner-only: system themes plus the token user's (B11-B13)" },
  { file: "src/lib/media/cleanup-admin.ts", pattern: "filter", count: 3, reason: "the media queue of one owner folder (D6); callers pass access.ownerId" },
  { file: "src/lib/pages/create-page-core.ts", pattern: "filter", count: 2, reason: "creating a site counts the account's own sites (B3, HL001)" },
  { file: "src/lib/pages/current.ts", pattern: "compare", count: 2, reason: "own pages carry the owner filter; shared ones come from the gate (C3)" },
  { file: "src/lib/pages/delete-account.ts", pattern: "filter", count: 1, reason: "deleting an account deletes its own sites (B21, T19)" },
  { file: "src/lib/pages/delete-page-core.ts", pattern: "filter", count: 3, reason: "deleting a site is owner-only (B2)" },
  { file: "src/lib/previews/core.ts", pattern: "compare", count: 2, reason: "share links are owner-only (B8, G4)" },
  { file: "src/lib/previews/shared.ts", pattern: "or", count: 1, reason: "a share link reads its site OWNER's themes (D7)" },
  { file: "src/lib/publish/core.ts", pattern: "or", count: 1, reason: "themes of the site owner: ownerId is access.ownerId (D2)" },
  { file: "src/lib/publish/invalidate.ts", pattern: "filter", count: 1, reason: "expire all of an account's sites at suspension (B22)" },
  { file: "src/lib/publish/unpublish.ts", pattern: "compare", count: 1, reason: "unpublishing a site is owner-only (B1)" },
  { file: "src/lib/templates/load.ts", pattern: "filter", count: 1, reason: "system themes only (owner_id is null): no account's data" },
  { file: "src/lib/themes/client.ts", pattern: "compare", count: 1, reason: "a system theme flag (owner_id null), no membership question" },
  { file: "src/lib/themes/client.ts", pattern: "or", count: 1, reason: "the retry's scope to the site owner (C11, ownerId from access)" },
  { file: "src/lib/themes/load.ts", pattern: "compare", count: 1, reason: "a system theme flag (owner_id null), no membership question" },
  { file: "src/lib/themes/load.ts", pattern: "or", count: 1, reason: "system themes plus the site owner's (C11; ownerId is access.ownerId)" },
  { file: "src/lib/versions/core.ts", pattern: "filter", count: 1, reason: "the site owner's draft write, bound from access.ownerId (A30)" },
  { file: "src/lib/versions/core.ts", pattern: "or", count: 1, reason: "the site owner's themes, bound from access.ownerId (A29)" },
];

/** Rule 2: every `p_owner_id` argument, as written, and why it is the site's owner. */
const P_OWNER_ID: Readonly<Record<string, { values: string[]; reason: string }>> = {
  "src/lib/content/publish-core.ts": { values: ["ready.access.ownerId", "ready.access.ownerId", "ready.access.ownerId"], reason: "the writer's access" },
  "src/lib/content/schedule-core.ts": { values: ["ready.access.ownerId", "ready.access.ownerId"], reason: "the writer's access" },
  "src/lib/content/trash-core.ts": { values: ["ready.access.ownerId", "ready.access.ownerId"], reason: "the writer's access" },
  "src/lib/site-pages/sub-pages-core.ts": { values: ["access.ownerId"], reason: "requireEntryAccess" },
  "src/lib/publish/core.ts": { values: ["ownerId", "ownerId"], reason: "const ownerId = access.ownerId / opened.site.ownerId (from access)" },
  "src/lib/content/site-page-publish-core.ts": { values: ["input.ownerId", "input.ownerId"], reason: "its one caller passes opened.site.ownerId (publish/core.ts)" },
  "src/lib/publish/unpublish.ts": { values: ["userId"], reason: "owner-only (B1): checked owner_id === userId above" },
};
/** Rule 2: rpc calls whose argument object spreads another object, and why none carries p_owner_id. */
const RPC_SPREADS: Readonly<Record<string, string>> = {
  "src/lib/publish/core.ts": "publish_design: a conditional p_expected_rev; p_owner_id is written out (ownerId)",
};

const P_OWNER_VALUE = /\bp_owner_id\s*:\s*([^,}\n]+)/g;
const P_OWNER_SHORTHAND = /[{,]\s*p_owner_id\s*[,}]/g;
const RPC_SPREAD = /\.rpc\(\s*["'`]\w+["'`]\s*,\s*\{(?:[^}]*?[{,])?\s*\.\.\.[\w(]/;

/** Rule 3: a call of the helper (an import alone is not one). */
const HELPER_CALL = /\b(?:require(?:Site|Entry|Term)Access|siteFor|entryFor|termFor|siteAccessFor)\s*\(/;
const SITE_TABLE = new RegExp(
  `\\.from\\(\\s*${Q}(?:pages|content_[a-z_]+|page_versions|site_paths|content_schedules)${Q}\\s*\\)|\\bp_(?:site|page)_id\\s*:`,
);
const SECRET_KEY = /createAdminSupabase|SupabaseClient<Database>|type Admin\b|AdminClient|admin: /;
/** Rule 3: modules that use site tables with the secret key without calling the helper, and why. */
const SECRET_KEY_READERS: Readonly<Record<string, string>> = {
  "src/app/(tenant)/published-page.ts": "public reads: published only (D15)",
  "src/lib/admin/account-queries.ts": "admin (D11)",
  "src/lib/admin/draft-view.ts": "admin read-only draft view (D13)",
  "src/lib/admin/queries.ts": "admin (D11)",
  "src/lib/admin/suspension.ts": "is a page offline: published facts (D15)",
  "src/lib/analytics/dashboard/source.ts": "owner-only analytics (B9)",
  "src/lib/analytics/ingest/pages.ts": "analytics ingest: public (D15)",
  "src/lib/billing/gift-queries.ts": "billing (B18)",
  "src/lib/blog/published.ts": "public reads: published only (D15)",
  "src/lib/content/prune-terms.ts": "called by the writer after its access check",
  "src/lib/content/site-page-publish-core.ts": "called by publish/core.ts after requireSiteAccess (publish)",
  "src/lib/domains/page-handle.ts": "domains (B6)",
  "src/lib/editor/draft-write.ts": "the MCP draft writer, owner-only (B16, M19-13)",
  "src/lib/forms/store.ts": "a visitor's form submission to a published page (D15): no actor",
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
  "src/lib/site-pages/entry-revisions-core.ts": "the entry-of-the-URL's-site pre-check; the writer it calls decides access",
  "src/lib/site-pages/entry-save-core.ts": "the entry-of-the-URL's-site pre-check; updateEntryWithClient decides access",
};

/** Rule 4: an import of the access helper, any of its modules. */
const ACCESS_IMPORT = /from\s+["'](?:@\/lib\/access(?:\/(?:server|decide|index))?|\.\/decide|\.\/index)["']/;

interface Findings {
  owner: Record<string, number>;
  pOwner: Record<string, string[]>;
  spreads: string[];
  bare: string[];
  cached: string[];
}

/** Everything the rules look at, for a set of files (the mutation check runs it on a fake file). */
function scan(list: readonly string[], text: (file: string) => string = read): Findings {
  const out: Findings = { owner: {}, pOwner: {}, spreads: [], bare: [], cached: [] };
  for (const file of list) {
    const source = code(text(file));
    for (const [name, pattern] of Object.entries(OWNER_PATTERNS)) {
      const count = (source.match(pattern) ?? []).length;
      if (count > 0) out.owner[`${file} ${name}`] = count;
    }
    const values = [
      ...[...source.matchAll(P_OWNER_VALUE)].map((m) => m[1]!.trim()),
      ...[...source.matchAll(P_OWNER_SHORTHAND)].map(() => "p_owner_id (shorthand)"),
    ];
    if (values.length > 0) out.pOwner[file] = values;
    if (RPC_SPREAD.test(source)) out.spreads.push(file);
    if (SITE_TABLE.test(source) && SECRET_KEY.test(source) && !HELPER_CALL.test(source)) out.bare.push(file);
    if (ACCESS_IMPORT.test(source) && /unstable_cache\(|["']use cache["']/.test(source)) out.cached.push(file);
  }
  return out;
}

describe("M19-12 no check bypasses the one access helper", () => {
  const found = scan(files);

  it("M19-12 owner_id is compared only where the allowlist says: file, pattern, count", () => {
    expect(found.owner).toEqual(
      Object.fromEntries(OWNER_COMPARISONS.map((row) => [`${row.file} ${row.pattern}`, row.count])),
    );
    for (const row of OWNER_COMPARISONS) expect(row.reason, row.file).not.toBe("");
  });

  it("M19-12 every p_owner_id is the site owner from the access helper (or a listed owner-only path)", () => {
    expect(found.pOwner).toEqual(
      Object.fromEntries(Object.entries(P_OWNER_ID).map(([file, row]) => [file, row.values])),
    );
    expect(found.spreads.sort()).toEqual(Object.keys(RPC_SPREADS).sort());
  });

  it("M19-12 a secret-key user of site tables CALLS the helper or is listed with its reason", () => {
    expect(found.bare.sort()).toEqual(Object.keys(SECRET_KEY_READERS).sort());
  });

  it("M19-12 access is never cached across requests (T6)", () => {
    expect(found.cached).toEqual([]);
    for (const file of files.filter((f) => f.startsWith("src/lib/access/"))) {
      const source = code(read(file));
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
      expect(code(read(file)), file).toMatch(/current\.access\.isOwner/);
    }
    expect(code(read("src/lib/access/decide.ts"))).toMatch(/if \(source === "mcp" && !row\.is_owner\) return "not_found";/);
  });
});

describe("S5 the guard catches every form of a bypass (mutation check)", () => {
  const FAKE = "src/lib/fake/bypass.ts";
  const ADMIN = `import { createAdminSupabase } from "@/lib/supabase/admin";\nconst admin = createAdminSupabase();\n`;
  const FORMS: Array<[string, string, (f: Findings) => boolean]> = [
    ["eq with single quotes", `${ADMIN}admin.from("x").select().eq('owner_id', u);`, (f) => `${FAKE} filter` in f.owner],
    ["eq with a table prefix in a template literal", `${ADMIN}admin.from("x").select().eq(\`site.owner_id\`, u);`, (f) => `${FAKE} filter` in f.owner],
    ["filter()", `${ADMIN}admin.from("x").select().filter("owner_id", "eq", u);`, (f) => `${FAKE} filter` in f.owner],
    ["match({ owner_id })", `${ADMIN}admin.from("x").select().match({ owner_id: u });`, (f) => `${FAKE} match` in f.owner],
    ["a no-space comparison", `${ADMIN}if (row.owner_id===u) {}`, (f) => `${FAKE} compare` in f.owner],
    ["the reverse comparison", `${ADMIN}if (u !== row.owner_id) {}`, (f) => `${FAKE} compare` in f.owner],
    ["or() with quotes", `${ADMIN}admin.from("x").select().or("owner_id.eq." + u);`, (f) => `${FAKE} or` in f.owner],
    ["p_owner_id from the actor", `${ADMIN}admin.rpc("f", { p_owner_id: userId });`, (f) => f.pOwner[FAKE]?.[0] === "userId"],
    ["p_owner_id shorthand", `${ADMIN}const p_owner_id = u; admin.rpc("f", { p_owner_id });`, (f) => (f.pOwner[FAKE] ?? []).includes("p_owner_id (shorthand)")],
    ["an rpc spreading its arguments", `${ADMIN}admin.rpc("f", { ...args });`, (f) => f.spreads.includes(FAKE)],
    ["from('pages') with single quotes", `${ADMIN}admin.from('pages').select("id");`, (f) => f.bare.includes(FAKE)],
    ["from(`content_entries`)", `${ADMIN}admin.from(\`content_entries\`).select("id");`, (f) => f.bare.includes(FAKE)],
    ["an rpc taking p_site_id", `${ADMIN}admin.rpc("f", { p_site_id: s });`, (f) => f.bare.includes(FAKE)],
    ["an rpc taking p_page_id", `${ADMIN}admin.rpc("f", { p_page_id: s });`, (f) => f.bare.includes(FAKE)],
    [
      "importing the helper without calling it",
      `import { requireSiteAccess } from "@/lib/access";\n${ADMIN}void requireSiteAccess; admin.from("pages").select("id");`,
      (f) => f.bare.includes(FAKE),
    ],
    [
      "a type import only",
      `import type { SiteAccess } from "@/lib/access";\n${ADMIN}admin.from("pages").select("id");`,
      (f) => f.bare.includes(FAKE),
    ],
    [
      "decide imported beside a cross-request cache",
      `import { decide } from "@/lib/access/decide";\nimport { unstable_cache } from "next/cache";\nexport const x = unstable_cache(async () => decide(null, "read", "editor"));`,
      (f) => f.cached.includes(FAKE),
    ],
  ];

  it.each(FORMS)("%s is caught", (_name, source, caught) => {
    expect(caught(scan([FAKE], () => source))).toBe(true);
  });

  it("a file that calls the helper is access-backed", () => {
    const source = `import { requireSiteAccess } from "@/lib/access";\n${ADMIN}await requireSiteAccess(admin, x); admin.from("pages").select("id");`;
    expect(scan([FAKE], () => source).bare).toEqual([]);
  });
});

describe("M19-12 new migrations keep site-scoped policies on the rule", () => {
  const dir = join(ROOT, "supabase/migrations");
  const migrations = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  const THIS_WAVE_LAST = "20261126220300";

  it("R13: the owner-only list is one list: the TypeScript constant equals access.owner_only_tables()", () => {
    const sql = readFileSync(join(dir, "20261126220400_team_review_fixes.sql"), "utf8");
    const body = /create function access\.owner_only_tables\(\)[\s\S]*?array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? "";
    expect([...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...OWNER_ONLY_TABLES]);
    // A later migration that redefines the function must come with this test reading it.
    for (const name of migrations.filter((file) => file > "20261126220400_team_review_fixes.sql")) {
      expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/function access\.owner_only_tables/);
    }
  });

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
    const ownerOnly: readonly string[] = OWNER_ONLY_TABLES;
    for (const name of migrations.filter((file) => file.slice(0, 14) > THIS_WAVE_LAST)) {
      const sql = readFileSync(join(dir, name), "utf8").toLowerCase();
      for (const [, policy, table, body] of sql.matchAll(/create policy (\w+) on public\.(\w+)([\s\S]*?);/g)) {
        if (!body!.includes("owner_id") || ownerOnly.includes(table!)) continue;
        expect(body, `${name}: ${policy}`).toMatch(/accessible_site_ids|readable_site_plans|shared_theme_owner_ids/);
      }
    }
  });
});
