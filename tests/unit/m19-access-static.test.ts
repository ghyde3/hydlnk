import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { OWNER_ONLY_TABLES } from "./m19-owner-only-tables";
import { ROOT, calleeName, calls, enclosingFunction, functionCalls, functionName, parse, readSource, sourceFiles, unwrap } from "./ts-scan";

/**
 * M19-12 (T6, T19, S5): the static guard of the one access rule. It fails when
 *   1. a file compares or filters on `owner_id` (`.eq/.neq/.filter/.in/.is/.not("owner_id"`, any
 *      quote, any `table.` prefix; `.match({ owner_id })`; `owner_id ===`/`!==` and the reverse, with
 *      or without spaces; `.or("owner_id…`) other than as the allowlist says: file, pattern, count;
 *   2. a `p_owner_id` argument is not `access.ownerId` or a value bound from it (listed), including
 *      the shorthand `{ p_owner_id }`, and an `.rpc(..., { ...spread })` that could carry one;
 *   3. (read from the TypeScript AST, team attack pass finding 3) a read or write of a site table
 *      (pages, content_*, page_versions, site_paths, preview_links and every owner-only table, a table
 *      name in a string constant resolved), of Storage, or an rpc with a site, entry or term id
 *      argument (the names the migrations use: p_site, p_site_id, p_page_id, p_entry_id, ...), on any
 *      client that is not the request's session client (made by createServerSupabase /
 *      createBrowserSupabase), sits in a named function that does not itself CALL an access helper
 *      (`require*Access(`, `siteFor(`, `entryFor(`, `termFor(`, `siteAccessFor(`) and that function is
 *      not listed with its reason (an import, `import type` or a comment is not a call);
 *   4. a module that imports the access helper (index, server or decide) uses a cross-request cache,
 *      or the helper itself keeps state or caches;
 *   5. a migration after this wave creates or alters a policy on a site-scoped table without the
 *      access projections, whatever its body (`using (true)`) or quoting, outside the owner-only
 *      tables, whose ONE list is OWNER_ONLY_TABLES (tests/unit/m19-owner-only-tables.ts), equal to
 *      the database's access.owner_only_tables().
 * The allowlists are the owner-only (B) and owner-scoped (D) rows of the plan. The S5 block below
 * feeds a throwaway file in each form of a bypass to the same scan and expects it caught.
 */

const files = sourceFiles();
const read = readSource;
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
  { file: "src/lib/mcp/page-access.ts", pattern: "filter", count: 8, reason: "MCP page access is owner-only (B11-B13, M19-13, G10); the eighth is the image resolver's post images of the token user's own sites (M18-05)" },
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

/**
 * Rule 3 (team attack pass, finding 3). A "site read or write" is any `.from(<table>)` of a site table,
 * any `.rpc(<fn>, { ... })` with a site, entry or term id argument, and any `.storage` (the owner's
 * media), on any client that is NOT the request's session client. A session client is recognised by
 * how it is made (`createServerSupabase()` / `createBrowserSupabase()`), never by its name; everything
 * else (the secret key, a `deps.db` passed in, a parameter) counts as the secret key. A table name in a
 * string constant of the file is resolved. The check is per FUNCTION: the nearest named function
 * around the read must itself call the helper, or `file:function` is listed with its reason.
 */
const HELPERS = new Set(["requireSiteAccess", "requireEntryAccess", "requireTermAccess", "siteFor", "entryFor", "termFor", "siteAccessFor"]);
const SESSION_FACTORIES = new Set(["createServerSupabase", "createBrowserSupabase"]);
/** Receivers of a `.from(...)` that is not a database call. */
const NOT_A_CLIENT = new Set(["Array", "Buffer", "Fragment", "Uint8Array", "Object", "Set", "Map", "String"]);
const SITE_TABLES: readonly string[] = [...OWNER_ONLY_TABLES, "pages", "page_versions", "site_paths", "preview_links"];
const isSiteTable = (table: string) => SITE_TABLES.includes(table) || /^content_[a-z_]+$/.test(table);

/** The site, entry and term id arguments the migrations' functions take (p_site, p_entry_id, ...), and p_domain. */
const ID_ARGS: ReadonlySet<string> = (() => {
  const dir = join(ROOT, "supabase/migrations");
  const names = new Set<string>(["p_domain"]);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(/\b(p_(?:site|page|entry|term|type)[a-z_]*)\s+uuid\b/g)) names.add(m[1]!);
  }
  return names;
})();

/** `file:function` of every site read or write on a non-session client whose function calls no helper. */
function unchecked(file: string, text: string): string[] {
  const sf = parse(file, text);
  const constants = new Map<string, string>();
  const session = new Set<string>();
  const otherwise = new Set<string>();
  const declare = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer ? unwrap(node.initializer) : null;
      if (init && ts.isStringLiteralLike(init)) constants.set(node.name.text, init.text);
      if (init && ts.isCallExpression(init) && SESSION_FACTORIES.has(calleeName(init) ?? "")) session.add(node.name.text);
      else otherwise.add(node.name.text);
    } else if ((ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) {
      otherwise.add(node.name.text);
    }
    ts.forEachChild(node, declare);
  };
  declare(sf);
  // A name made by a session factory and never bound any other way in the file.
  const isSession = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) return session.has(e.text) && !otherwise.has(e.text);
    return ts.isCallExpression(e) && SESSION_FACTORIES.has(calleeName(e) ?? "");
  };
  const resolve = (arg: ts.Expression | undefined): string | null => {
    if (!arg) return null;
    const e = unwrap(arg);
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isIdentifier(e) && constants.has(e.text)) return constants.get(e.text)!;
    return null; // not resolvable here: counted as a site table
  };
  const uses: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = node.expression;
      const name = node.name.text;
      if (name === "storage" && !isSession(receiver)) uses.push(node);
      const call = node.parent;
      if ((name === "from" || name === "rpc") && ts.isCallExpression(call) && call.expression === node) {
        const r = unwrap(receiver);
        const onStorage = ts.isPropertyAccessExpression(r) && r.name.text === "storage"; // counted as .storage
        const notClient = ts.isIdentifier(r) && NOT_A_CLIENT.has(r.text);
        if (!onStorage && !notClient && !isSession(receiver)) {
          if (name === "from") {
            const table = resolve(call.arguments[0]);
            if (table === null || isSiteTable(table)) uses.push(node);
          } else {
            const args = call.arguments[1] ? unwrap(call.arguments[1]) : null;
            if (args && !ts.isObjectLiteralExpression(args)) uses.push(node); // arguments built elsewhere
            else if (args && args.properties.some((p) => p.name !== undefined && ID_ARGS.has(p.name.getText(sf)))) uses.push(node);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const all = calls(sf);
  const out = new Set<string>();
  for (const use of uses) {
    const fn = enclosingFunction(use);
    if (!functionCalls(fn, all, HELPERS)) out.add(`${file}:${functionName(fn, sf)}`);
  }
  return [...out];
}

/**
 * Rule 3: the functions that read or write site data with the secret key (or a client passed in)
 * without calling the helper themselves, by file, with why. A new function in a listed file is not
 * excused: the list names functions.
 */
const SECRET_KEY_USERS: Readonly<Record<string, { reason: string; functions: string[] }>> = {
  "src/app/(tenant)/published-page.ts": { reason: "public reads: published only (D15)", functions: ["lookupPage", "readHandleId", "readPublic"] },
  "src/lib/access/index.ts": { reason: "the helper itself (site_access) and the activity row it records after a check", functions: ["recordSiteActivity", "requireSiteAccess"] },
  "src/lib/admin/account-queries.ts": { reason: "admin (D11): executeAdminAction / the admin gate decide", functions: ["getAccountDetail"] },
  "src/lib/admin/actions.ts": { reason: "admin actions (D11): executeAdminAction checks the admin first", functions: ["pagesOf", "suspendAccountAction", "unsuspendAccountAction"] },
  "src/lib/admin/draft-view.ts": { reason: "admin read-only draft view (D13)", functions: ["loadAdminDraftView"] },
  "src/lib/admin/queries.ts": { reason: "admin (D11)", functions: ["countSuspendedAccounts", "listReports"] },
  "src/lib/admin/recheck-domain-action.ts": { reason: "admin action (D11): domains of any account", functions: ["run"] },
  "src/lib/admin/suspension.ts": { reason: "is an account suspended / a page offline: facts, no site content (D15)", functions: ["isAccountSuspended", "isPageOffline"] },
  "src/lib/analytics/admin/review-flag-action.ts": { reason: "admin action (D11): executeAdminAction checks the admin first", functions: ["run.audit"] },
  "src/lib/analytics/dashboard/source.ts": { reason: "owner-only analytics (B9): the screens check current.access.isOwner", functions: ["createAdminStatsSource.dailyDims", "createAdminStatsSource.dailySiteUniques", "createAdminStatsSource.dailyStats", "createAdminStatsSource.hasActivity", "createAdminStatsSource.historicPageIds", "createAdminStatsSource.resolvePage", "hiddenHistoryIds", "readBlogPages", "readViewedPosts"] },
  "src/lib/analytics/ingest/pages.ts": { reason: "analytics ingest: published pages, public (D15)", functions: ["readBeaconPage", "readCore", "readIndexShard"] },
  "src/lib/auth/accounts.ts": { reason: "the signed-in user's own accounts row", functions: ["ensureAccount"] },
  "src/lib/billing/account.ts": { reason: "billing is the account's own (B18)", functions: ["readBillingAccount"] },
  "src/lib/billing/checkout.ts": { reason: "billing is the account's own (B18)", functions: ["ensureStripeCustomer"] },
  "src/lib/billing/gift-actions.ts": { reason: "admin gifts (D11)", functions: ["readPlans"] },
  "src/lib/billing/gift-queries.ts": { reason: "billing (B18)", functions: ["loadGiftAccount"] },
  "src/lib/billing/webhook.ts": { reason: "the Stripe webhook: a signed event, no actor", functions: ["findAccount", "saveCustomerId"] },
  "src/lib/blocklist/admin-actions.ts": { reason: "admin blocklist impact (D11)", functions: ["readImpact"] },
  "src/lib/blog/published.ts": { reason: "public reads: published only (D15)", functions: ["getPublishedPost", "liveEntries", "readIsLive", "readLatestPosts", "readLiveIdBySlug", "readLiveSlugOf", "readSiteArchives", "readSiteOwnerId", "readSlugRedirects", "readTermIndex"] },
  "src/lib/content/guards.ts": { reason: "siteType: called by the guards' callers after siteFor/entryFor", functions: ["siteType"] },
  "src/lib/content/images.ts": { reason: "the owner folder's objects, called by the writers after their access check", functions: ["checkOwnImages"] },
  "src/lib/content/prune-terms.ts": { reason: "called by the writer after its access check", functions: ["pruneTerms"] },
  "src/lib/content/publish-core.ts": { reason: "prepare() calls entryFor; refused() re-reads the rev of that entry", functions: ["publishEntryWithClient", "refused", "unpublishEntryWithClient"] },
  "src/lib/content/query-core.ts": { reason: "changedSincePublish: called by the list after siteFor, on its rows", functions: ["changedSincePublish"] },
  "src/lib/content/revisions-core.ts": { reason: "keepCurrentDraft: called by restoreRevisionWithClient after entryFor and siteFor(edit)", functions: ["keepCurrentDraft", "keepCurrentDraft.record"] },
  "src/lib/content/schedule-core.ts": { reason: "prepare() calls entryFor (publish); refusedSchedule re-reads that entry; summaries are read after siteFor", functions: ["cancelScheduleWithClient", "refusedSchedule", "scheduleEntryWithClient", "scheduleSummariesWithClient"] },
  "src/lib/content/site-page-publish-core.ts": { reason: "called by publish/core.ts after requireSiteAccess (publish)", functions: ["publishSitePageWithClient"] },
  "src/lib/content/trash-core.ts": { reason: "prepare() calls entryFor; refused() re-reads the rev of that entry", functions: ["refused", "restoreEntryWithClient", "trashEntryWithClient"] },
  "src/lib/content/types-core.ts": { reason: "ownedType() calls siteFor (owner, G14)", functions: ["enableTypeWithClient", "updateTypeWithClient"] },
  "src/lib/domains/core.ts": { reason: "domains are owner-only (B6): owner_id === userId checked in the core", functions: ["addDomain", "countDomains", "listDomainViews", "ownsPage", "readAccount", "removeDomain", "setDomainPage"] },
  "src/lib/domains/page-handle.ts": { reason: "domains (B6)", functions: ["lookupHandleByPageId"] },
  "src/lib/domains/primary.ts": { reason: "a site's verified domain: public routing fact (D15)", functions: ["readPrimaryDomain"] },
  "src/lib/domains/verify.ts": { reason: "the domain check worker and owner-only domains (B6)", functions: ["announceLive", "freshRow", "readDomainRow", "releaseExpired", "sweepPendingDomains"] },
  "src/lib/editor/draft-write.ts": { reason: "the MCP draft writer, owner-only (B16, M19-13)", functions: ["writeDraft"] },
  "src/lib/forms/audience.ts": { reason: "a session client passed in (createServerSupabase): RLS, owner-only form_submissions (G3)", functions: ["countFiltered", "filtered", "loadAudienceWithClient"] },
  "src/lib/forms/notify.ts": { reason: "the owner's address for a form notice: no actor", functions: ["readOwner"] },
  "src/lib/forms/store.ts": { reason: "a visitor's form submission to a published page (D15): no actor", functions: ["recordSubmission"] },
  "src/lib/handles/availability.ts": { reason: "handle availability: no site data", functions: ["checkHandle"] },
  "src/lib/handles/claim-core.ts": { reason: "claiming a handle: the account's own first site (B4)", functions: ["claimHandleWithClient", "giveHomeEntry"] },
  "src/lib/handles/claim.ts": { reason: "claiming a handle (B4)", functions: ["accountHasPage"] },
  "src/lib/mcp/page-access.ts": { reason: "MCP, owner-only (B11-B13)", functions: ["listOwnedPages", "listOwnedSubPageDocs", "listPageDomains", "listSubPageSummaries", "listUsableThemes", "loadAccountPlan", "loadHomeEntries", "loadOwnedPage", "loadOwnedSubPage", "loadThemeTokens", "typeIdsOf", "listOwnedPostImageDocs"] },
  "src/lib/media/cleanup-admin.ts": { reason: "the owner folder's queue and objects; callers pass access.ownerId and siteId", functions: ["adminCleanupDeps.remove", "queueNewUpload"] },
  "src/lib/media/quota.ts": { reason: "the owner's quota and folder; the upload route checks access (edit) first", functions: ["adminUploadQuota.discard", "adminUploadQuota.read"] },
  "src/lib/media/upload.ts": { reason: "the owner's folder; the upload route checks access (edit) first", functions: ["adminStorage"] },
  "src/lib/oauth/store-supabase.ts": { reason: "OAuth: is the token user suspended, no site data", functions: ["createSupabaseOauthStore.isSuspended"] },
  "src/lib/pages/create-page-core.ts": { reason: "creating a site counts the account's own sites (B3)", functions: ["limitMessage", "nameNewPage"] },
  "src/lib/pages/delete-domains.ts": { reason: "deleting the account's own domains (B21)", functions: ["removeAccountDomains"] },
  "src/lib/pages/delete-media.ts": { reason: "deleting the account's own folder (B21)", functions: ["removeAccountMedia"] },
  "src/lib/pages/delete-page-core.ts": { reason: "deleting a site, owner-only (B2)", functions: ["deletePageWithClient"] },
  "src/lib/previews/core.ts": { reason: "share links, owner-only (B8): ownsPage() compares owner_id", functions: ["createPreviewLinkCore", "listPreviewLinksCore", "ownsPage", "revokePreviewLinkCore"] },
  "src/lib/previews/shared.ts": { reason: "the share link page (D7): the token is the access", functions: ["loadDraftPost", "loadDraftPreview", "loadSharedPreview"] },
  "src/lib/publish/core.ts": { reason: "publish cores: openSite()/requireSiteAccess in the caller of each; loaders take its ownerId", functions: ["loadThemeTokens", "publishDesignCore", "publishSitePageCore", "storageExists"] },
  "src/lib/publish/invalidate.ts": { reason: "suspension expiry (B22)", functions: ["invalidateAccountPages"] },
  "src/lib/publish/link-rules.ts": { reason: "the page's hosts for the redirect rule; the gate checked access", functions: ["ownHostsOf"] },
  "src/lib/publish/unpublish.ts": { reason: "unpublish, owner-only (B1): owner_id === userId", functions: ["unpublishSiteCore"] },
  "src/lib/reports/server.ts": { reason: "abuse reports: public pages (D15)", functions: ["findReportPageByAddress", "publishedPage", "reportDeps.store"] },
  "src/lib/routing/custom-domain.ts": { reason: "the proxy's custom-host lookup: public routing (D15)", functions: ["readDomain"] },
  "src/lib/schedule/boundaries.ts": { reason: "the schedule worker: no actor", functions: ["sweepBlockBoundaries"] },
  "src/lib/site-pages/entry-revisions-core.ts": { reason: "the entry-of-the-URL's-site pre-check; the writer it calls decides access", functions: ["isEntryOfSite"] },
  "src/lib/site-pages/entry-save-core.ts": { reason: "the entry-of-the-URL's-site pre-check; updateEntryWithClient decides access", functions: ["saveEntryDraftWithClient"] },
  "src/lib/site/page-entries-core.ts": { reason: "read helpers called after an access check (or on published data)", functions: ["countSubPageEntriesWithClient", "getHomeDraftWithClient", "getLivePageWithClient", "getPublishedHomeWithClient", "listAllPageEntriesWithClient", "listArchiveTypesWithClient", "listDraftPagesWithClient", "listLivePagesWithClient", "listPagePathsWithClient", "pageTypeId", "readLiveSubPageWithClient", "readSubPageEntryWithClient", "readTrashedSubPageIdWithClient"] },
  "src/lib/team/core.ts": { reason: "team rpcs take p_actor: the SQL calls require_site_access (owner) itself", functions: ["inviteMemberCore", "leaveSiteCore", "loadTeamCore", "removeMemberCore", "setMemberRoleCore"] },
  "src/lib/themes/client.ts": { reason: "a session client passed in (the browser's): RLS on themes", functions: ["deleteSavedTheme", "fetchThemeLibrary", "insertSavedTheme", "updateRow"] },
  "src/lib/versions/core.ts": { reason: "openVersion() calls requireSiteAccess; the loaders take its ownerId", functions: ["loadThemeTokens", "restorePageVersionCore", "storageExists"] },
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
    out.bare.push(...unchecked(file, text(file)));
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

  it("M19-12 a secret-key user of site tables CALLS the helper in the same function, or is listed with its reason", () => {
    const listed = Object.entries(SECRET_KEY_USERS).flatMap(([file, row]) => row.functions.map((fn) => `${file}:${fn}`));
    expect(found.bare.sort()).toEqual(listed.sort());
    for (const [file, row] of Object.entries(SECRET_KEY_USERS)) expect(row.reason, file).not.toBe("");
  });

  it("finding 3: the id arguments come from the migrations and include the site, entry and term ids", () => {
    for (const name of ["p_site", "p_site_id", "p_page_id", "p_entry_id", "p_entry", "p_domain"]) expect(ID_ARGS.has(name), name).toBe(true);
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
  const bare = (f: Findings) => f.bare.some((entry) => entry.startsWith(`${FAKE}:`));
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
    ["from('pages') with single quotes", `${ADMIN}admin.from('pages').select("id");`, bare],
    ["from(`content_entries`)", `${ADMIN}admin.from(\`content_entries\`).select("id");`, bare],
    ["an rpc taking p_site_id", `${ADMIN}admin.rpc("f", { p_site_id: s });`, bare],
    ["an rpc taking p_page_id", `${ADMIN}admin.rpc("f", { p_page_id: s });`, bare],
    [
      "importing the helper without calling it",
      `import { requireSiteAccess } from "@/lib/access";\n${ADMIN}void requireSiteAccess; admin.from("pages").select("id");`,
      bare,
    ],
    [
      "a type import only",
      `import type { SiteAccess } from "@/lib/access";\n${ADMIN}admin.from("pages").select("id");`,
      bare,
    ],
    // Team attack pass, finding 3: the four bypass forms the attacker found, and the per-function rule.
    ["an owner-only table (form_submissions)", `${ADMIN}admin.from("form_submissions").select("id");`, bare],
    ["Storage", `${ADMIN}admin.storage.from("page-media").remove([p]);`, bare],
    [
      "a secret-key client passed in as a parameter (deps.db)",
      `import type { SupabaseClient } from "@supabase/supabase-js";\nexport async function f(deps: { db: SupabaseClient }) { await deps.db.from("pages").select("id"); }`,
      bare,
    ],
    ["a table name in a constant", `${ADMIN}const TABLE = "content_entries";\nadmin.from(TABLE).select("id");`, bare],
    ["an rpc taking p_site", `${ADMIN}admin.rpc("f", { p_site: s });`, bare],
    ["an rpc taking p_entry_id", `${ADMIN}admin.rpc("f", { p_entry_id: e });`, bare],
    ["an rpc whose arguments are built elsewhere", `${ADMIN}const args = { p_site: s };\nadmin.rpc("f", args);`, bare],
    [
      "one checked function does not excuse an unchecked one",
      `import { requireSiteAccess } from "@/lib/access";\n${ADMIN}export async function checked(x) { await requireSiteAccess(admin, x); }\nexport async function unchecked() { await admin.from("pages").select("id"); }`,
      (f) => f.bare.includes(`${FAKE}:unchecked`) && !f.bare.includes(`${FAKE}:checked`),
    ],
    [
      "a helper named in a comment is not a call",
      `${ADMIN}export async function f() { /* requireSiteAccess(admin, x) */ await admin.from("pages").select("id"); }`,
      bare,
    ],
    [
      "a secret-key client named like a session client",
      `${ADMIN}const supabase = createAdminSupabase();\nsupabase.from("pages").select("id");`,
      bare,
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

  it("finding 3: the request's session client (made by createServerSupabase) is RLS, not the secret key", () => {
    const source = `import { createServerSupabase } from "@/lib/supabase/server";\nexport async function f() { const supabase = await createServerSupabase(); await supabase.from("pages").select("id"); }`;
    expect(scan([FAKE], () => source).bare).toEqual([]);
  });

  it("a file that calls the helper is access-backed", () => {
    const source = `import { requireSiteAccess } from "@/lib/access";\n${ADMIN}await requireSiteAccess(admin, x); admin.from("pages").select("id");`;
    expect(scan([FAKE], () => source).bare).toEqual([]);
  });
});

/**
 * Finding 3: the tables a policy must put on the access rule (every table keyed by a site, the
 * server-only ones included: a policy appearing there at all is the bug), apart from the owner-only
 * tables, whose ONE list is OWNER_ONLY_TABLES.
 */
const SITE_SCOPED = /^(?:pages|content_[a-z_]+|page_versions|site_paths|preview_links|events|traffic_flags|mcp_activity|reports)$/;
const ACCESS_PROJECTION = /access\.(?:accessible_site_ids|readable_site_plans|shared_theme_owner_ids)\(/;
const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const POLICY = new RegExp(String.raw`\b(create|alter)\s+policy\s+(${IDENT})\s+on\s+(?:(${IDENT})\.)?(${IDENT})([\s\S]*?);`, "gi");
const unquote = (name: string) => (name.startsWith('"') ? name.slice(1, -1) : name.toLowerCase());

/** `table: policy` for each policy in `sql` on a site-scoped, non-owner-only table that skips the rule. */
function policyFindings(sql: string): string[] {
  const ownerOnly: readonly string[] = OWNER_ONLY_TABLES;
  const out: string[] = [];
  const text = sql.replace(/--.*$/gm, "");
  for (const [, , policy, schema, table, body] of text.matchAll(POLICY)) {
    const name = unquote(table!);
    if ((schema && unquote(schema) !== "public") || ownerOnly.includes(name) || !SITE_SCOPED.test(name)) continue;
    if (!ACCESS_PROJECTION.test(body!.toLowerCase())) out.push(`${name}: ${unquote(policy!)}`);
  }
  return out;
}

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

  it("M19-12, finding 3: every later policy on a site-scoped table uses the rule (or is on an owner-only table)", () => {
    for (const name of migrations.filter((file) => file.slice(0, 14) > THIS_WAVE_LAST)) {
      expect(policyFindings(readFileSync(join(dir, name), "utf8")), name).toEqual([]);
    }
  });

  it("finding 3: the policy check reads every policy, whatever its body or quoting (synthetic SQL)", () => {
    const caught: Array<[string, string]> = [
      ["using (true)", "create policy members_read on public.pages for select to authenticated using (true);"],
      ["a quoted name and quoted table", 'create policy "Members read" on "public"."content_entries" for select to authenticated using (owner_id = (select auth.uid()));'],
      ["no schema", "create policy x on content_terms for select to authenticated using (true);"],
      ["upper case", "CREATE POLICY X ON PUBLIC.PAGE_VERSIONS FOR SELECT TO AUTHENTICATED USING (TRUE);"],
      ["an alter policy", "alter policy pages_select on public.pages using (true);"],
      ["a server-only site table", "create policy p on public.preview_links for select to anon using (true);"],
    ];
    for (const [label, sql] of caught) expect(policyFindings(sql), label).toHaveLength(1);
    expect(policyFindings("create policy ok on public.content_entries for select to authenticated using (site_id in (select access.accessible_site_ids('read')));")).toEqual([]);
    expect(policyFindings("create policy own on public.domains for select to authenticated using (true);")).toEqual([]);
    expect(policyFindings("create policy t on public.oauth_tokens for select to authenticated using (true);")).toEqual([]);
  });
});
