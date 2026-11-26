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
