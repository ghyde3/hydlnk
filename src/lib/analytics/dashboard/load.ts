import "server-only";
import { loadExport, loadStats, type ExportResult, type LoadStatsInput } from "../stats";
import type { StatsResponse } from "./types";
import { createAdminStatsSource } from "./source";

/**
 * `loadStats` against the real database, for the Analytics page and its stats route. A failure is
 * logged (with the page id, never the rows) and answered as `load_failed`: the screen then shows
 * "We couldn't load your stats. Try again." instead of an error page.
 */
export async function loadStatsResponse(input: LoadStatsInput): Promise<StatsResponse> {
  try {
    return await loadStats(input, createAdminStatsSource());
  } catch (error) {
    console.error(`[analytics] loading stats for page ${input.pageId} failed`, error);
    return { ok: false, error: "load_failed" };
  }
}

/**
 * `loadExport` against the real database, for the CSV export route (M9-26): the same source, so the
 * same ownership check and plan window as the screen. A failure is logged and answered as
 * `load_failed`.
 */
export async function loadExportResponse(
  input: LoadStatsInput,
): Promise<ExportResult | { ok: false; error: "load_failed" }> {
  try {
    return await loadExport(input, createAdminStatsSource());
  } catch (error) {
    console.error(`[analytics] exporting stats for page ${input.pageId} failed`, error);
    return { ok: false, error: "load_failed" };
  }
}
