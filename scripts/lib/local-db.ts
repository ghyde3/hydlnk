import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The local Postgres container of THIS checkout's Supabase stack, for the tests that reach the
 * database with `docker exec ... psql` (DDL and server-only rows no API role may write). The Supabase
 * CLI names it `supabase_db_{project_id}` from supabase/config.toml, so a second checkout with its own
 * stack (another project_id and ports) never runs its SQL against the main checkout's database.
 * `supabase_db_hydlnk` when the file cannot be read (the main checkout's and CI's name).
 */
function localDbContainer(): string {
  try {
    const config = readFileSync(join(process.cwd(), "supabase/config.toml"), "utf8");
    const id = /^project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m.exec(config)?.[1];
    return `supabase_db_${id ?? "hydlnk"}`;
  } catch {
    return "supabase_db_hydlnk";
  }
}

export const LOCAL_DB_CONTAINER = localDbContainer();

/**
 * Runs SQL as `postgres` in this checkout's local database container and returns psql's unaligned
 * output; throws on an error. For test fixtures no API role may write (for example rows seeded past
 * a trigger with `session_replication_role = replica`). Local stacks only.
 */
export async function localPsql(sql: string): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  return execFileSync(
    "docker",
    ["exec", "-i", LOCAL_DB_CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
    { input: sql, encoding: "utf8" },
  );
}

/**
 * `count` sign-ups on one form of a site, dated `createdAt` (default the 1st of this UTC month),
 * written with no trigger running: the form caps' fixtures (M17-02), so a test can stand at a cap
 * without the per-site daily cap refusing the seed itself.
 */
export async function seedFormRows(
  siteId: string,
  count: number,
  opts: { blockId?: string; createdAt?: string; prefix?: string } = {},
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(siteId) || !Number.isInteger(count) || count < 1) {
    throw new Error("seedFormRows: a site id and a whole count");
  }
  const blockId = opts.blockId ?? "formSeed0001";
  const prefix = opts.prefix ?? "seed";
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(blockId) || !/^[a-z0-9-]{1,20}$/.test(prefix)) {
    throw new Error("seedFormRows: a block id and a plain prefix");
  }
  const at = opts.createdAt
    ? `'${new Date(opts.createdAt).toISOString()}'::timestamptz`
    : "public.form_usage_month()::timestamp at time zone 'utc'";
  await localPsql(`begin;
set local session_replication_role = replica;
insert into public.form_submissions (site_id, block_id, kind, email, created_at)
  select '${siteId}', '${blockId}', 'signup', '${prefix}' || g || '@example.test', ${at}
  from generate_series(1, ${count}) g;
commit;`);
}
