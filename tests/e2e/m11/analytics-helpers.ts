import { randomUUID } from "node:crypto";
import { adminClient } from "../fixtures/auth";
import { dayAt, rollUp } from "../m4/analytics-dash-helpers";
import {
  getClick,
  ingestPage,
  postBeacon,
  randomIp,
  waitForEvents,
  type IngestPage,
} from "../m4/analytics-ingest-helpers";

/**
 * Shared setup for the per-page analytics specs (M11-09): a site with a live sub-page, driven through
 * the real routes (`/api/e`, `/r`) with the secret key only where the product itself would (the
 * sub-page rows, moving events to yesterday so the nightly rollup, run for real, counts them).
 */

export const ITEMS_TITLE = "Items for sale";
export const ITEMS_LINK = { id: "itemlink0001", label: "Armchair" } as const;
export const HOME_LINK = { id: "lnkbook0001", label: "Book" } as const;

export interface SubPage {
  id: string;
}

/** A sub-page row of `site`: published (live) or a draft only. */
export async function addSubPage(
  site: IngestPage,
  opts: { path: string; title?: string; live?: boolean; link?: boolean },
): Promise<SubPage> {
  const title = opts.title ?? ITEMS_TITLE;
  const live = opts.live !== false;
  const doc = {
    path: opts.path,
    title,
    description: "",
    blocks:
      opts.link === false
        ? []
        : [
            {
              id: ITEMS_LINK.id,
              type: "link",
              visible: true,
              label: ITEMS_LINK.label,
              url: "https://example.com/armchair",
            },
          ],
  };
  const { data, error } = await adminClient()
    .from("site_pages")
    .insert({
      page_id: site.pageId,
      draft: doc,
      ...(live ? { published: doc, published_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`adding a sub-page failed: ${error.message}`);
  return { id: data.id as string };
}

/**
 * A pro site with Home and one live sub-page ("Items for sale"). Yesterday's traffic is inserted the
 * way the routes write it and rolled up by the real nightly rollup; today's comes through the real
 * routes and is read raw:
 *
 *                 yesterday (rolled up)        today (raw, via /api/e and /r)
 *   Home          1 view, 1 click (Book)
 *   Items         2 views, 1 click (Armchair)  1 view, 1 click (Armchair)
 *   deleted page  1 view (an id no page has)
 *
 * so All pages shows 5 views and 3 clicks; Home 1 and 1; Items 3 and 2; Deleted page 1 and 0.
 */
export async function trafficSite(label: string) {
  const site = await ingestPage(label, { plan: "pro" });
  const items = await addSubPage(site, { path: "items" });
  const deleted = randomUUID();

  const yesterday = dayAt(-1);
  const row = (sub: string | null, type: "view" | "click", visitor: string, blockId = "") => ({
    page_id: site.pageId,
    sub_page_id: sub,
    block_id: blockId,
    type,
    ts: `${yesterday}T12:00:00Z`,
    referrer: null,
    device: "mobile",
    country: "US",
    visitor_hash: visitor,
  });
  const inserted = await adminClient()
    .from("events")
    .insert([
      row(null, "view", "h1"),
      row(null, "click", "h1", HOME_LINK.id),
      row(items.id, "view", "i1"),
      row(items.id, "view", "i2"),
      row(items.id, "click", "i1", ITEMS_LINK.id),
      row(deleted, "view", "d1"),
    ]);
  if (inserted.error) throw new Error(`inserting events failed: ${inserted.error.message}`);
  await rollUp([yesterday]);

  const view = await postBeacon(
    site,
    { pageId: site.pageId, subPageId: items.id, referrer: "" },
    { ip: randomIp() },
  );
  const click = await getClick(site, ITEMS_LINK.id);
  if (view.status !== 204 || click.status !== 302) {
    throw new Error(`today's traffic answered ${view.status} and ${click.status}`);
  }
  await waitForEvents(site.pageId, 8);

  return { site, items, deleted, yesterday };
}
