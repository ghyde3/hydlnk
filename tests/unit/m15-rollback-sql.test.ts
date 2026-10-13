// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stackIsUp } from "./publish-support";

/**
 * M15-05 (1b1-08): supabase/rollback/content-move-rollback.sql. It is not a migration. At a rollback it
 * is copied into a new timestamped migration. It reverses the content move and puts the pre-1b-1 bodies
 * of the functions back. The static half compares each restored body with its original migration; the
 * integration half (skipped without the local database) applies the file inside a rolled-back
 * transaction and runs the legacy code paths.
 */

const root = process.cwd();
const rollbackPath = resolve(root, "supabase/rollback/content-move-rollback.sql");
const migration = (name: string) =>
  readFileSync(resolve(root, "supabase/migrations", name), "utf8");

/** One statement: from its first line to the first line that ends it. Last occurrence in the file. */
function statement(sql: string, startRe: RegExp, endRe: RegExp): string {
  const lines = sql.split("\n");
  let start = -1;
  lines.forEach((line, i) => {
    if (startRe.test(line)) start = i;
  });
  if (start < 0) throw new Error(`no statement starting ${startRe}`);
  let end = start;
  while (end < lines.length && !endRe.test(lines[end]!)) end += 1;
  return lines.slice(start, end + 1).join("\n");
}

function functionText(sql: string, name: string): string {
  const text = statement(
    sql,
    new RegExp(`^create (or replace )?function public\\.${name}\\(`),
    /^\$\$;$/,
  );
  return text.replace(/^create function/, "create or replace function");
}

function commentText(sql: string, signature: string): string {
  return statement(
    sql,
    new RegExp(`^comment on function public\\.${signature.replace(/[()]/g, "\\$&")} is`),
    /;$/,
  );
}

const restored: { name: string; file: string; comment?: string }[] = [
  {
    name: "publish_site",
    file: "20261011000003_publish_site.sql",
    comment: "publish_site(uuid, uuid, jsonb, jsonb, timestamptz)",
  },
  {
    name: "record_page_version",
    file: "20261012000001_site_versions.sql",
    comment: "record_page_version()",
  },
  {
    name: "unpublish_site",
    file: "20261013000010_unpublish_site.sql",
    comment: "unpublish_site(uuid, uuid)",
  },
  { name: "site_click_pairs", file: "20261012000003_item_click_pairs.sql" },
  { name: "admin_overview_numbers", file: "20261013000006_admin_readers.sql" },
  { name: "admin_account_detail", file: "20261013000006_admin_readers.sql" },
  {
    name: "admin_blocked_domain_impact",
    file: "20261011000001_site_pages.sql",
    comment: "admin_blocked_domain_impact(text, integer)",
  },
  { name: "enforce_link_blocklist", file: "20261003000004_blocklist_hardening.sql" },
];

describe("content-move-rollback.sql, static", () => {
  const sql = readFileSync(rollbackPath, "utf8");

  for (const r of restored) {
    it(`restores ${r.name} verbatim from ${r.file}`, () => {
      expect(sql).toContain(functionText(migration(r.file), r.name));
      if (r.comment) expect(sql).toContain(commentText(migration(r.file), r.comment));
    });
  }

  it("runs the reverse first, then drops the guards and the new blocklist trigger", () => {
    const reverse = sql.indexOf("select public.reverse_all_content()");
    expect(reverse).toBeGreaterThan(-1);
    for (const needle of [
      "drop trigger enforce_content_moved on public.pages",
      "drop trigger enforce_content_moved on public.site_pages",
      "drop trigger enforce_link_blocklist_update on public.pages",
      "drop function public.guard_frozen_page_blocks()",
      "drop function public.guard_moved_site_pages()",
      "drop function public.enforce_pages_link_blocklist_update()",
    ]) {
      const at = sql.indexOf(needle);
      expect(at, needle).toBeGreaterThan(reverse);
    }
    // The original pages trigger: insert and update of draft, the one function.
    expect(sql).toContain(
      "create trigger enforce_link_blocklist before insert or update of draft on public.pages",
    );
  });

  it("is not a migration and drops no table", () => {
    expect(sql).not.toMatch(/drop table|truncate/i);
  });
});

const { run: stackUp } = await stackIsUp();
function dockerDb(): boolean {
  try {
    execFileSync("docker", ["exec", "supabase_db_hydlnk", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const haveDb = stackUp && dockerDb();

const SITE = "00000000-0000-4000-8000-0000000c8a01";
const OWNER = "00000000-0000-4000-8000-0000000c8001";
const ALPHA = "00000000-0000-4000-8000-0000000c8a11";

function scenario(rollback: string): string {
  return `
begin;
\\set ON_ERROR_STOP on
insert into auth.users (id, instance_id, aud, role, email)
  values ('${OWNER}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rb-1b108@example.test');
update public.accounts set paid_plan = 'pro' where id = '${OWNER}';
insert into public.pages (id, owner_id, handle, draft) values
  ('${SITE}', '${OWNER}', 'zq1b108',
   '{"version":1,"rev":3,"profile":{"name":"A","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[{"id":"hd","type":"text","visible":true,"text":"draft home"}]}');
select set_config('hydlnk.content_move', 'on', true);
update public.pages
  set published = '{"version":1,"profile":{"name":"A","bio":"","photo":null},"blocks":[{"id":"hp","type":"text","visible":true,"text":"live home"}]}',
      published_at = '2026-02-01 10:00:00+00'
  where id = '${SITE}';
select set_config('hydlnk.content_move', 'off', true);
insert into public.site_pages (id, page_id, draft, published, published_at) values
  ('${ALPHA}', '${SITE}',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[]}',
   '{"path":"alpha","title":"Alpha","description":"","blocks":[]}', '2026-02-02 10:00:00+00');

set local role service_role;
select public.move_site_content('${SITE}');
-- Edits through the entries, as the new code makes them.
update public.content_entries e
  set draft = jsonb_set(e.draft, '{blocks}', '[{"id":"hd2","type":"text","visible":true,"text":"edited home"}]')
  where e.site_id = '${SITE}' and e.draft ->> 'path' = '/';
update public.content_entries e
  set draft = '{"path":"alpha","title":"Alpha edited","description":"","blocks":[]}'
  where e.id = '${ALPHA}';
reset role;

${rollback}

select 'R|entries|' || count(*) from public.content_entries where site_id = '${SITE}';
select 'R|guards|' || count(*) from pg_trigger where tgname = 'enforce_content_moved' and not tgisinternal;
select 'R|home_draft_text|' || (draft -> 'blocks' -> 0 ->> 'text') from public.pages where id = '${SITE}';
select 'R|alpha_draft_title|' || (draft ->> 'title') from public.site_pages where id = '${ALPHA}';

-- The legacy publish_site writes site_pages and pages, and the legacy trigger records the version.
set local role service_role;
select public.publish_site(
  '${SITE}', '${OWNER}',
  (select draft from public.pages where id = '${SITE}'),
  jsonb_build_array(jsonb_build_object('id', '${ALPHA}',
    'published', (select draft from public.site_pages where id = '${ALPHA}'))));
reset role;
select 'R|alpha_published_title|' || (published ->> 'title') from public.site_pages where id = '${ALPHA}';
select 'R|home_published_text|' || (published -> 'blocks' -> 0 ->> 'text') from public.pages where id = '${SITE}';
select 'R|versions|' || count(*) from public.page_versions where page_id = '${SITE}';
select 'R|version_sub_title|' || (sub_pages -> 0 ->> 'title') from public.page_versions
  where page_id = '${SITE}' order by version_no desc limit 1;

-- Unpublish clears the legacy rows.
set local role service_role;
select public.unpublish_site('${SITE}', '${OWNER}');
reset role;
select 'R|alpha_unpublished|' || (published is null) from public.site_pages where id = '${ALPHA}';

-- The owner can update site_pages under RLS again.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${OWNER}","role":"authenticated"}', true);
with u as (
  update public.site_pages set draft = jsonb_set(draft, '{title}', '"Owner edit"') where id = '${ALPHA}' returning 1
) select 'R|owner_update|' || count(*) from u;
reset role;
rollback;
`;
}

describe.skipIf(!haveDb)("content-move-rollback.sql, applied", () => {
  it("brings back the legacy publish, versions, unpublish and owner edits after a move and edits", () => {
    const rollback = readFileSync(rollbackPath, "utf8");
    const out = execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_hydlnk",
        "psql",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      { input: scenario(rollback), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    const got: Record<string, string> = {};
    for (const line of out.split("\n")) {
      const m = /^R\|([^|]+)\|(.*)$/.exec(line);
      if (m) got[m[1]!] = m[2]!;
    }
    expect(got).toEqual({
      entries: "0",
      guards: "0",
      home_draft_text: "edited home",
      alpha_draft_title: "Alpha edited",
      alpha_published_title: "Alpha edited",
      home_published_text: "edited home",
      versions: "2", // the setup publish, then the legacy publish_site
      version_sub_title: "Alpha edited",
      alpha_unpublished: "true",
      owner_update: "1",
    });
  });
});
