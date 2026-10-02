import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { ReportAddress } from "./address";
import type { ReportDeps, ReportPage } from "./submit";

/**
 * The real dependencies of the report form (M5-05): the secret-key client, the page lookups and the
 * two SQL functions (`report_rate_limit_hit`, `submit_report`). The tables and functions are not in
 * the generated types yet, so the client is used loosely here and nowhere else.
 */

const looseDb = () => createAdminSupabase() as unknown as SupabaseClient;

/** Page rows are only ever read as id and handle: no page content leaves the database. */
async function publishedPage(
  db: SupabaseClient,
  column: "id" | "handle",
  value: string,
): Promise<ReportPage | null> {
  const { data, error } = await db
    .from("pages")
    .select("id, handle")
    .eq(column, value)
    .not("published_at", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Reading the page failed: ${error.message}`);
  return data ? { id: String(data.id), handle: String(data.handle) } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function findReportPageById(id: string): Promise<ReportPage | null> {
  if (!UUID.test(id)) return null;
  return publishedPage(looseDb(), "id", id);
}

export async function findReportPageByAddress(address: ReportAddress): Promise<ReportPage | null> {
  const db = looseDb();
  if (address.kind === "handle") return publishedPage(db, "handle", address.handle);
  const { data, error } = await db
    .from("domains")
    .select("page_id")
    .eq("hostname", address.hostname)
    .eq("status", "verified")
    .maybeSingle();
  if (error) throw new Error(`Reading the domain failed: ${error.message}`);
  return data ? publishedPage(db, "id", String(data.page_id)) : null;
}

export function reportDeps(): ReportDeps {
  const db = looseDb();
  return {
    // VISITOR_HASH_SECRET is required on Vercel; off Vercel the secret key stands in.
    secret: serverEnv.VISITOR_HASH_SECRET ?? serverEnv.SUPABASE_SECRET_KEY,
    rootDomain: clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
    now: () => new Date(),
    findPageById: findReportPageById,
    findPageByAddress: findReportPageByAddress,
    async limiter(hashes, limit, windowSeconds) {
      const { data, error } = await db.rpc("report_rate_limit_hit", {
        p_keys: hashes,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error(`Counting the report failed: ${error.message}`);
      const answer = data as { allowed?: boolean; retry_after?: number } | null;
      return { allowed: answer?.allowed === true, retryAfter: Number(answer?.retry_after ?? 1) };
    },
    async store(record) {
      const { data, error } = await db.rpc("submit_report", {
        p_page_id: record.pageId,
        p_page_handle: record.pageHandle,
        p_reason: record.reason,
        p_details: record.details,
        p_email: record.email,
        p_hashes: record.hashes,
        p_page_cap: record.pageCap,
      });
      if (error) throw new Error(`Filing the report failed: ${error.message}`);
      return data === "duplicate" || data === "page_capped" ? data : "created";
    },
  };
}
