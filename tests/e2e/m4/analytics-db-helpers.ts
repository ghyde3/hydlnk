import { expect } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";

/**
 * Helpers for the analytics storage specs (Wave E: M4-24, M4-25, M4-30, M5-10). Events are written
 * with the secret key (the only way in), rolled up with the secret-key RPCs, and read back the way a
 * stranger with the publishable key would.
 */

/** The UTC calendar date `daysAgo` days before now, "2026-10-03". Agrees with the database's UTC days. */
export const utcDay = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

export interface EventSpec {
  type?: "view" | "click";
  /** Required for a click; views are page-level (''). */
  block?: string;
  /** UTC day (yyyy-mm-dd) and time of day. */
  day: string;
  time?: string;
  referrer?: string | null;
  device?: string | null;
  country?: string | null;
  visitor: string;
}

/** Inserts events with the secret key, in chunks. */
export async function addEvents(pageId: string, events: EventSpec[]): Promise<void> {
  const admin = adminClient();
  for (let start = 0; start < events.length; start += 5000) {
    const rows = events.slice(start, start + 5000).map((e) => ({
      page_id: pageId,
      block_id: e.type === "click" ? (e.block ?? "Bt5rJ1fGz6Os") : "",
      type: e.type ?? "view",
      ts: `${e.day}T${e.time ?? "12:00:00"}Z`,
      referrer: e.referrer ?? null,
      device: e.device ?? "mobile",
      country: e.country ?? "US",
      visitor_hash: e.visitor,
    }));
    const { error } = await admin.from("events").insert(rows);
    if (error) throw new Error(`addEvents failed: ${error.message}`);
  }
}

/** `count` page views on one UTC day, from `distinct` visitors. */
export async function addViews(pageId: string, day: string, count: number, distinct = 200) {
  await addEvents(
    pageId,
    Array.from({ length: count }, (_, i) => ({ day, visitor: `v${i % distinct}` })),
  );
}

/** rollup_daily_stats(day) with the secret key: the number of daily_stats rows written. */
export async function rollupDay(day: string): Promise<number> {
  const { data, error } = await adminClient().rpc("rollup_daily_stats", { p_day: day });
  if (error) throw new Error(`rollup_daily_stats(${day}) failed: ${error.message}`);
  return data as number;
}

export interface RestResult {
  status: number;
  body: unknown;
}

/** PostgREST with the publishable key; a user's JWT makes it role authenticated, none makes it anon. */
export async function rest(
  path: string,
  init: { method?: string; jwt?: string; body?: unknown } = {},
): Promise<RestResult> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: publishableKey(),
      "content-type": "application/json",
      ...(init.jwt ? { Authorization: `Bearer ${init.jwt}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  return { status: res.status, body };
}

/**
 * The API said no for the right reason: 401 (anon) or 403 (authenticated) with Postgres's
 * insufficient_privilege (42501). A 404 (PGRST202: no such function) would look like a refusal but
 * proves nothing about the revoke, so it fails here.
 */
export function expectDenied(res: RestResult, what: string): void {
  expect([401, 403], `${what}: status (body ${JSON.stringify(res.body)})`).toContain(res.status);
  expect((res.body as { code?: string } | null)?.code, `${what}: error code`).toBe("42501");
}

/** The rows of a successful GET (an empty array when RLS hides everything). */
export function rowsOf(res: RestResult, what: string): Record<string, unknown>[] {
  expect(res.status, `${what}: status (body ${JSON.stringify(res.body)})`).toBe(200);
  expect(Array.isArray(res.body), `${what}: an array`).toBe(true);
  return res.body as Record<string, unknown>[];
}
