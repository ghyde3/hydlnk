import { expect, type Page } from "@playwright/test";
import { adminClient, readEnv } from "../fixtures/auth";
import { url } from "../helpers";
import { SCHEDULE_TEST_IDS } from "@/lib/schedule/test-ids";

/**
 * Fixtures for the scheduling specs (Wave E, M20). Time is moved the honest way: a schedule is made
 * for later (the database refuses anything under a minute ahead), then its time is moved into the
 * past with the secret key, as a late tick would find it, and the cron route is called with the local
 * secret. No spec waits for a real minute.
 */

export { SCHEDULE_TEST_IDS };

/** A canonical UTC minute `minutes` from now (negative: in the past). */
export function minutesFromNow(minutes: number): string {
  const ms = Math.floor((Date.now() + minutes * 60_000) / 60_000) * 60_000;
  return new Date(ms).toISOString().slice(0, 16) + ":00Z";
}

/** POST /api/cron/run-schedules on the app host with the local CRON_SECRET, as pg_cron's call does. */
export async function runSchedules(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url("app", "/api/cron/run-schedules"), {
    method: "POST",
    headers: { authorization: `Bearer ${readEnv("CRON_SECRET")}`, "content-type": "application/json" },
    body: "{}",
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Every pending schedule of the entry is now due (`minutes` ago). */
export async function makeDue(entryId: string, minutes = 2): Promise<void> {
  const at = new Date(Math.floor((Date.now() - minutes * 60_000) / 60_000) * 60_000).toISOString();
  const { error } = await adminClient()
    .from("content_schedules")
    .update({ run_at: at })
    .eq("entry_id", entryId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

export async function schedulesOf(entryId: string) {
  const { data, error } = await adminClient()
    .from("content_schedules")
    .select("action, status, result_code, run_at")
    .eq("entry_id", entryId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

/** Home's page entry of a site. */
export async function homeEntry(siteId: string): Promise<{ id: string; published: unknown }> {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("id, published, content_types!inner(key)")
    .eq("site_id", siteId)
    .eq("content_types.key", "page")
    .eq("draft->>path", "/")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, published: data.published };
}

/** Fills a native datetime-local control with a local wall time (`YYYY-MM-DDTHH:MM`). */
export async function fillLocal(page: Page, testId: string, local: string, nth = 0): Promise<void> {
  const input = page.getByTestId(testId).nth(nth);
  await input.fill(local);
  await expect(input).toHaveValue(local);
}
