import { expect, test } from "@playwright/test";
import type { Block } from "@/lib/document";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { PRODUCTION_BUILD } from "../fixtures/http";
import { publishDocOf, publishedPage } from "../m2/blocks-helpers";
import { homeEntry, runSchedules } from "./scheduling-helpers";

/**
 * M20-04 against a production build (the page is cached): a link scheduled to end is in the cached
 * page; real time passes its end (nothing in the database is rewritten, no publish, no expiry), the
 * cached page still holds it, then the cron route runs with the secret and the next GET no longer
 * contains it. `next dev` caches nothing, so this spec runs on a production build only.
 *
 * Deterministic against the local pg_cron job: without the Vault secrets (the local stack never has
 * them) `run_schedule_sweep` changes nothing and only reports that it cannot reach the app
 * (migration 20261126210000), so the boundary is still due when this spec's own POST runs.
 */

test.afterAll(cleanupUsers);

/** The first whole minute at least `seconds` from now, canonical. */
function minuteAfter(seconds: number): string {
  const ms = Math.ceil((Date.now() + seconds * 1000) / 60_000) * 60_000;
  return new Date(ms).toISOString().slice(0, 16) + ":00Z";
}

test("M20-04 the cached page drops a link at its boundary after the cron tick, with no publish", async ({
  request,
}, info) => {
  test.skip(!PRODUCTION_BUILD, "needs a production build: next dev caches no page");
  test.skip(info.project.name !== "desktop", "one run is enough: the cache is shared");
  test.setTimeout(240_000);
  const until = minuteAfter(70);
  const ending: Block = {
    id: "lnkEndingE2E1",
    type: "link",
    visible: true,
    label: "Last call",
    url: "https://example.com/last",
    schedule: { until },
  } as Block;
  const keep: Block = {
    id: "lnkKeepE2E01",
    type: "link",
    visible: true,
    label: "Always here",
    url: "https://example.com/always",
  } as Block;
  const site = await publishedPage("m20cache", publishDocOf([ending, keep]), { plan: "pro" });
  const home = await homeEntry(site.pageId);
  const admin = adminClient();
  const stored = await admin
    .from("content_entries")
    .select("next_boundary_at")
    .eq("id", home.id)
    .single();
  expect(Date.parse(stored.data!.next_boundary_at!)).toBe(Date.parse(until));

  const first = await request.get(site.url);
  expect(await first.text()).toContain("lnkEndingE2E1");

  // Real time passes the end; nothing expires the cached page by itself.
  await expect
    .poll(() => Date.now() > Date.parse(until) + 2_000, { timeout: 150_000, intervals: [5_000] })
    .toBe(true);
  expect(await (await request.get(site.url)).text()).toContain("lnkEndingE2E1");

  const tick = await runSchedules();
  expect(tick.status).toBe(200);
  expect(Number(tick.body.sites)).toBeGreaterThanOrEqual(1);

  const after = await (await request.get(site.url)).text();
  expect(after).not.toContain("lnkEndingE2E1");
  expect(after).not.toContain("Last call");
  expect(after).toContain("lnkKeepE2E01");
  const row = await admin
    .from("content_entries")
    .select("next_boundary_at")
    .eq("id", home.id)
    .single();
  expect(row.data?.next_boundary_at).toBeNull();
});
