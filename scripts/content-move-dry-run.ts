/**
 * Dry run of the content move (M15-05, 1b1-24): the live HTML of every published site must be
 * byte-identical before and after the cutover, on a LOCAL copy of the data.
 *
 *   pnpm tsx scripts/content-move-dry-run.ts snapshot --phase before
 *   (apply the migrations, run move_site_content for every site)
 *   pnpm tsx scripts/content-move-dry-run.ts snapshot --phase after
 *   pnpm tsx scripts/content-move-dry-run.ts diff before after
 *   pnpm tsx scripts/content-move-dry-run.ts check --phase after
 *
 * snapshot fetches, from a local `next start` (DRY_RUN_APP_URL, default http://localhost:3000, built
 * with NEXT_PUBLIC_ROOT_DOMAIN=localhost:<port>), for every site with a published Home and on the
 * handle host and each verified custom host: Home, every live sub-page, sitemap.xml, robots.txt and
 * the OG image bytes. It writes them, a responses.json (status and content type) and counts.json to
 * tmp/dry-run/<phase>/<site_id>/. diff compares every file byte for byte and every count exactly,
 * no normalizing, and exits non-zero naming each site that differs. check --phase after runs the
 * after-only checks against the database.
 *
 * Guard: before any request or query it exits non-zero unless SUPABASE_URL and the app URL are
 * 127.0.0.1 or localhost. It reads process.env only (never an env file, never .env.production) and
 * reaches the database through the local supabase_db_hydlnk container, so it cannot reach production.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface FetchRequest {
  /** The Host header, port included for a handle host. */
  host: string;
  path: string;
}
export interface FetchResult {
  status: number;
  contentType: string;
  body: Buffer;
}
export interface DryRunDeps {
  fetch: (req: FetchRequest) => Promise<FetchResult>;
  /** Runs one SQL text against the local database and returns psql's -At output. */
  sql: (text: string) => string;
  outDir: string;
  log: (line: string) => void;
}

interface SiteRow {
  id: string;
  handle: string;
  owner_id: string;
  plan: string;
  domains: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_WORD = /^[a-z0-9-]+$/;
const PHASE = /^[A-Za-z0-9_-]{1,40}$/;
const DB_CONTAINER = "supabase_db_hydlnk";

export function isLocalUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function realSql(text: string): string {
  const run = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
    { input: text, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`psql failed: ${run.stderr || run.error?.message}`);
  return run.stdout.trim();
}

function realFetch(appUrl: string): DryRunDeps["fetch"] {
  const target = new URL(appUrl);
  return (req) =>
    new Promise((resolvePromise, reject) => {
      const r = http.request(
        {
          hostname: target.hostname === "localhost" ? "127.0.0.1" : target.hostname,
          port: target.port || 80,
          path: req.path,
          method: "GET",
          headers: { host: req.host, "accept-encoding": "identity" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolvePromise({
              status: res.statusCode ?? 0,
              contentType: String(res.headers["content-type"] ?? ""),
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    });
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const SITES_SQL = `-- sites
select coalesce(json_agg(json_build_object(
  'id', p.id, 'handle', p.handle, 'owner_id', p.owner_id, 'plan', a.plan,
  'domains', (select coalesce(json_agg(d.hostname order by d.hostname), '[]'::json)
              from public.domains d where d.page_id = p.id and d.status = 'verified')
) order by p.handle), '[]'::json)
from public.pages p join public.accounts a on a.id = p.owner_id
where p.published_at is not null;`;

function modeSql(site: string): string {
  return `-- mode
select case
  when to_regclass('public.site_paths') is null then 'legacy'
  when (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.site_paths where site_id = %L and path = %L', '${site}', '/'), false, true, '')))[1]::text = '0' then 'legacy'
  else 'entries' end;`;
}

function countsSql(site: SiteRow, mode: string): string {
  const home =
    mode === "entries"
      ? `select e.id, true as is_home, e.published as doc from public.content_entries e
         join public.site_paths sp on sp.entry_id = e.id and sp.path = '/' where e.site_id = '${site.id}'`
      : `select p.id, true, p.published from public.pages p where p.id = '${site.id}'`;
  const subs =
    mode === "entries"
      ? `select e.id, false as is_home, e.published as doc from public.content_entries e
         join public.content_types t on t.id = e.type_id and t.key = 'page'
         where e.site_id = '${site.id}' and e.deleted_at is null
           and not exists (select 1 from public.site_paths sp where sp.entry_id = e.id and sp.path = '/')`
      : `select s.id, false, s.published from public.site_pages s where s.page_id = '${site.id}'`;
  return `-- counts
with home as (${home}), subs as (${subs}),
pagesall as (select * from home union all select * from subs),
live as (select * from pagesall where doc is not null)
select json_build_object(
  'livePages', (select coalesce(json_agg(json_build_object(
      'id', case when l.is_home then null else l.id end,
      'path', coalesce(l.doc ->> 'path', '/'),
      'blocks', (select coalesce(json_agg(b ->> 'id'), '[]'::json)
                 from jsonb_array_elements(case when jsonb_typeof(l.doc -> 'blocks') = 'array' then l.doc -> 'blocks' else '[]'::jsonb end) b))), '[]'::json)
      from live l),
  'clickPairs', (select coalesce(json_agg(json_build_object('block_id', c.block_id, 'sub_page_id', c.sub_page_id)), '[]'::json)
      from public.site_click_pairs('${site.id}') c),
  'navTargets', (select coalesce(json_agg(distinct t), '[]'::json) from (
      select jsonb_path_query(d, '$.nav.items[*]') #>> '{}' as t
      from (select doc as d from live union all select published from public.pages where id = '${site.id}') x
      where d is not null) y),
  'pageLinkTargets', (select coalesce(json_agg(json_build_object('path', z.path, 'target', z.target)), '[]'::json) from (
      select coalesce(l.doc ->> 'path', '/') as path,
             jsonb_path_query(l.doc, '$.blocks[*] ? (@.type == "page_link").target') #>> '{}' as target
      from live l) z),
  'pageVersions', (select count(*) from public.page_versions where page_id = '${site.id}'),
  'accountSiteBytes', coalesce((select b.bytes from public.account_site_bytes b where b.owner_id = '${site.owner_id}'), 0),
  'pageTotal', (select count(*) from pagesall),
  'pagesPerSite', (select l.pages_per_site from public.plan_limits('${site.plan}') l)
);`;
}

const CHECK_SQL = `-- check
with docs as (
  select e.site_id, e.id as entry_id, e.draft as d, false as pub from public.content_entries e where e.deleted_at is null
  union all
  select e.site_id, e.id, e.published, true from public.content_entries e where e.deleted_at is null and e.published is not null
  union all
  select p.id, null, p.draft, false from public.pages p
  union all
  select p.id, null, p.published, true from public.pages p where p.published is not null
),
targets as (
  select site_id, entry_id, pub, jsonb_path_query(d, '$.nav.items[*]') #>> '{}' as t from docs
  union all
  select site_id, entry_id, pub, jsonb_path_query(d, '$.blocks[*] ? (@.type == "page_link").target') #>> '{}' from docs
)
select coalesce(json_agg(v), '[]'::json) from (
  select p.id::text || ': expected exactly one ''/'' entry, found ' || n::text as v
  from public.pages p
  cross join lateral (select count(*) as n from public.site_paths sp where sp.site_id = p.id and sp.path = '/' and sp.entry_id is not null) c
  where n <> 1
  union all
  select s.page_id::text || ': site_pages row ' || s.id::text || ' has no entry with its id'
  from public.site_pages s where not exists (select 1 from public.content_entries e where e.id = s.id)
  union all
  select s.page_id::text || ': site_pages row ' || s.id::text || ' has no moved_at'
  from public.site_pages s where s.moved_at is null
  union all
  select t.site_id::text || ': target ' || t.t || ' does not resolve to a page of the site'
  from targets t
  where t.t is not null and t.t <> 'home' and t.t <> ''
    and (t.pub or t.t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and not exists (
      select 1 from public.content_entries e
      join public.content_types ty on ty.id = e.type_id and ty.key = 'page'
      where e.site_id = t.site_id and e.deleted_at is null and e.id::text = lower(t.t))
  union all
  select e.site_id::text || ': entry ' || e.id::text || ' has more converted revisions than revisions_kept'
  from public.content_entries e
  join public.pages p on p.id = e.site_id
  join public.accounts a on a.id = p.owner_id
  where (select count(*) from public.content_entry_revisions r where r.entry_id = e.id and r.source = 'system')
        > (select l.revisions_kept from public.plan_limits(a.plan) l)
) q;`;

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

interface Counts {
  livePages: { id: string | null; path: string; blocks: string[] }[];
  clickPairs: { block_id: string; sub_page_id: string | null }[];
  navTargets: string[];
  pageLinkTargets: { path: string; target: string | null }[];
  [key: string]: unknown;
}

/** Order-insensitive parts are sorted so two reads of the same data are the same bytes. */
function normalizeCounts(raw: Counts): Counts {
  const by = <T>(rows: T[], key: (r: T) => string) =>
    [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return {
    ...raw,
    livePages: by(raw.livePages, (p) => p.path).map((p) => ({ ...p, blocks: [...p.blocks].sort() })),
    clickPairs: by(raw.clickPairs, (c) => `${c.block_id}|${c.sub_page_id ?? ""}`),
    navTargets: [...raw.navTargets].sort(),
    pageLinkTargets: by(raw.pageLinkTargets, (t) => `${t.path}|${t.target ?? ""}`),
  };
}

async function snapshot(phase: string, env: Record<string, string | undefined>, deps: DryRunDeps): Promise<number> {
  const port = new URL(env.DRY_RUN_APP_URL ?? "http://localhost:3000").port || "80";
  const sites = JSON.parse(deps.sql(SITES_SQL) || "[]") as SiteRow[];
  const phaseDir = join(deps.outDir, phase);
  rmSync(phaseDir, { recursive: true, force: true });
  for (const site of sites) {
    if (!UUID.test(site.id) || !UUID.test(site.owner_id) || !SAFE_WORD.test(site.plan)) {
      throw new Error(`unexpected site row ${JSON.stringify(site)}`);
    }
    const mode = deps.sql(modeSql(site.id)).trim() === "legacy" ? "legacy" : "entries";
    const counts = normalizeCounts(JSON.parse(deps.sql(countsSql(site, mode))) as Counts);
    const siteDir = join(phaseDir, site.id);
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(siteDir, "counts.json"), JSON.stringify(counts, null, 2) + "\n");

    const hosts: { dir: string; host: string }[] = [
      { dir: "handle", host: `${site.handle}.localhost:${port}` },
      ...site.domains.map((d) => ({ dir: `custom-${d}`, host: d })),
    ];
    const subPaths = counts.livePages.map((p) => p.path).filter((p) => p !== "/");
    const responses: Record<string, { status: number; contentType: string }> = {};
    for (const { dir, host } of hosts) {
      const files: [string, string][] = [
        ["home.html", "/"],
        ...subPaths.map((p): [string, string] => [`page-${p}.html`, `/${p}`]),
        ["sitemap.xml", "/sitemap.xml"],
        ["robots.txt", "/robots.txt"],
        ["og.bin", "/og"],
      ];
      mkdirSync(join(siteDir, dir), { recursive: true });
      for (const [name, path] of files) {
        const res = await deps.fetch({ host, path });
        writeFileSync(join(siteDir, dir, name), res.body);
        responses[`${dir}/${name}`] = { status: res.status, contentType: res.contentType };
      }
    }
    writeFileSync(join(siteDir, "responses.json"), JSON.stringify(responses, null, 2) + "\n");
    deps.log(`snapshot ${phase}: ${site.id} (${site.handle}, ${counts.livePages.length} live pages)`);
  }
  deps.log(`snapshot ${phase}: ${sites.length} sites written to ${phaseDir}`);
  return 0;
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

function listFiles(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

function siteDirs(phaseDir: string): string[] {
  if (!existsSync(phaseDir)) return [];
  return readdirSync(phaseDir)
    .filter((n) => statSync(join(phaseDir, n)).isDirectory())
    .sort();
}

export interface DiffReport {
  /** Site ids with any difference, sorted. */
  differing: string[];
  /** One line per differing file. */
  details: string[];
}

/** Every file byte for byte, counts.json included; a file or a site on one side only differs. */
export function diffSnapshots(root: string, a: string, b: string): DiffReport {
  const dirA = join(root, a);
  const dirB = join(root, b);
  const ids = [...new Set([...siteDirs(dirA), ...siteDirs(dirB)])].sort();
  const differing: string[] = [];
  const details: string[] = [];
  for (const id of ids) {
    const filesA = existsSync(join(dirA, id)) ? listFiles(join(dirA, id)) : null;
    const filesB = existsSync(join(dirB, id)) ? listFiles(join(dirB, id)) : null;
    if (!filesA || !filesB) {
      differing.push(id);
      details.push(`${id}: only in ${filesA ? a : b}`);
      continue;
    }
    let differs = false;
    for (const file of [...new Set([...filesA, ...filesB])].sort()) {
      if (!filesA.includes(file) || !filesB.includes(file)) {
        differs = true;
        details.push(`${id}: ${file} only in ${filesA.includes(file) ? a : b}`);
      } else if (!readFileSync(join(dirA, id, file)).equals(readFileSync(join(dirB, id, file)))) {
        differs = true;
        details.push(`${id}: ${file} differs`);
      }
    }
    if (differs) differing.push(id);
  }
  return { differing, details };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const USAGE =
  "Usage: content-move-dry-run.ts snapshot --phase <name> | diff <a> <b> | check --phase after";

function phaseArg(argv: string[]): string | null {
  const i = argv.indexOf("--phase");
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value && PHASE.test(value) ? value : null;
}

export async function main(argv: string[], env: Record<string, string | undefined>, deps: DryRunDeps): Promise<number> {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const appUrl = env.DRY_RUN_APP_URL ?? "http://localhost:3000";
  if (!isLocalUrl(supabaseUrl) || !isLocalUrl(appUrl)) {
    deps.log(
      `Refusing to run: SUPABASE_URL and the app URL must be 127.0.0.1 or localhost (got "${supabaseUrl}" and "${appUrl}").`,
    );
    return 1;
  }
  const [command] = argv;
  try {
    if (command === "snapshot") {
      const phase = phaseArg(argv);
      if (!phase) return (deps.log(USAGE), 2);
      return await snapshot(phase, env, deps);
    }
    if (command === "diff") {
      const [a, b] = argv.slice(1);
      if (!a || !b || !PHASE.test(a) || !PHASE.test(b)) return (deps.log(USAGE), 2);
      const report = diffSnapshots(deps.outDir, a, b);
      if (report.differing.length === 0) {
        deps.log(`diff ${a} ${b}: identical`);
        return 0;
      }
      for (const line of report.details) deps.log(line);
      deps.log(`diff ${a} ${b}: ${report.differing.length} site(s) differ: ${report.differing.join(", ")}`);
      return 1;
    }
    if (command === "check") {
      if (phaseArg(argv) !== "after") return (deps.log(USAGE), 2);
      const violations = JSON.parse(deps.sql(CHECK_SQL) || "[]") as string[];
      for (const v of violations) deps.log(v);
      deps.log(`check after: ${violations.length} violation(s)`);
      return violations.length === 0 ? 0 : 1;
    }
  } catch (error) {
    deps.log(error instanceof Error ? error.message : String(error));
    return 1;
  }
  deps.log(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const appUrl = process.env.DRY_RUN_APP_URL ?? "http://localhost:3000";
  main(process.argv.slice(2), process.env, {
    fetch: realFetch(appUrl),
    sql: realSql,
    outDir: resolve(process.cwd(), "tmp", "dry-run"),
    log: (line) => console.log(line),
  }).then((code) => process.exit(code));
}
