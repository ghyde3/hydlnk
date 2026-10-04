import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { BlockedDomainRow } from "./admin-view";

/**
 * The reads behind /admin/blocked-links (M7-13), with the secret key (the screen sits behind
 * `requireAdmin`). `blocked_domains` is server only: no client can read it.
 */

export const BLOCKED_PAGE_SIZE = 50;

/** `?page=n`: a whole number from 1 to 10,000, else 1. */
export function parseBlockedPage(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : 1;
}

/**
 * One page of blocked domains, newest first (the starter list shares one date, so it falls back to
 * alphabetical). One more row than a page is read, to know whether a next page exists.
 */
export async function listBlockedDomains(
  page = 1,
): Promise<{ rows: BlockedDomainRow[]; hasMore: boolean }> {
  const db = createAdminSupabase();
  const from = (Math.max(1, Math.floor(page)) - 1) * BLOCKED_PAGE_SIZE;
  const { data, error } = await db
    .from("blocked_domains")
    .select("domain, reason, created_at")
    .order("created_at", { ascending: false })
    .order("domain", { ascending: true })
    .range(from, from + BLOCKED_PAGE_SIZE);
  if (error) throw new Error(`Listing blocked domains failed: ${error.message}`);
  const fetched = data ?? [];
  return {
    rows: fetched.slice(0, BLOCKED_PAGE_SIZE).map((row) => ({
      domain: row.domain,
      reason: row.reason,
      createdAt: row.created_at,
    })),
    hasMore: fetched.length > BLOCKED_PAGE_SIZE,
  };
}

/** How many domains are blocked, for the Admin overview tile. */
export async function countBlockedDomains(): Promise<number> {
  const db = createAdminSupabase();
  const { count, error } = await db
    .from("blocked_domains")
    .select("domain", { count: "exact", head: true });
  if (error) throw new Error(`Counting blocked domains failed: ${error.message}`);
  return count ?? 0;
}
