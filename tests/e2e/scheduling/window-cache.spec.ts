import { expect, test } from "@playwright/test";
import type { Block } from "@/lib/document";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { PRODUCTION_BUILD } from "../fixtures/http";
import { publishDocOf, publishedPage } from "../m2/blocks-helpers";
import { homeEntry, minutesFromNow, runSchedules } from "./scheduling-helpers";

/**
 * M20-04 against a production build (the page is cached): a link scheduled to end is in the cached
 * page; the test moves its boundary into the past in the database (no publish, no cache expiry), the
 * cached page still holds it, then the cron route runs with the secret and the next GET no longer
 * contains it. `next dev` caches nothing, so this spec runs on a production build only.
 */

test.afterAll(cleanupUsers);

test("M20-04 the cached page drops a link at its boundary after the cron tick, with no publish", async ({
  request,
}, info) => {
  test.skip(!PRODUCTION_BUILD, "needs a production build: next dev caches no page");
  test.skip(info.project.name !== "desktop", "one run is enough: the cache is shared");
  const ending: Block = {
    id: "lnkEndingE2E1",
    type: "link",
    visible: true,
    label: "Last call",
    url: "https://example.com/last",
    schedule: { until: minutesFromNow(30) },
  } as Block;
  const keep: Block = {
    id: "lnkKeepE2E01",
    type: "link",
    visible: true,
    label: "Always here",
    url: "https://example.com/always",
  } as Block;
  const site = await publishedPage("m20cache", publishDocOf([ending, keep]), { plan: "pro" });

  const first = await request.get(site.url);
  expect(await first.text()).toContain("lnkEndingE2E1");

  // The boundary passes: the same live copy with the end a minute ago, written as a migration or an
  // outage would leave it (the trigger keeps next_boundary_at in step), and no cache expiry.
  const home = await homeEntry(site.pageId);
  const published = home.published as { blocks: Array<Record<string, unknown>> };
  const moved = {
    ...published,
    blocks: published.blocks.map((block) =>
      block.id === "lnkEndingE2E1" ? { ...block, schedule: { until: minutesFromNow(-1) } } : block,
    ),
  };
  const admin = adminClient();
  const write = await admin.from("content_entries").update({ published: moved }).eq("id", home.id);
  expect(write.error).toBeNull();
  await admin.from("content_entries").update({ next_boundary_at: minutesFromNow(-1) }).eq("id", home.id);

  // Still the cached page: nothing expired it yet.
  expect(await (await request.get(site.url)).text()).toContain("lnkEndingE2E1");

  const tick = await runSchedules();
  expect(tick.status).toBe(200);
  expect(Number(tick.body.sites)).toBeGreaterThanOrEqual(1);

  const after = await (await request.get(site.url)).text();
  expect(after).not.toContain("lnkEndingE2E1");
  expect(after).not.toContain("Last call");
  expect(after).toContain("lnkKeepE2E01");
  const row = await admin.from("content_entries").select("next_boundary_at").eq("id", home.id).single();
  expect(row.data?.next_boundary_at).toBeNull();
});
