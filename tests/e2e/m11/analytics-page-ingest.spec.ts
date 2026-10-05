import { randomUUID } from "node:crypto";
import { cleanupUsers } from "../fixtures/data";
import {
  expect,
  getClick,
  ingestPage,
  postBeacon,
  settledCount,
  test,
  waitForClicks,
  waitForEvents,
} from "../m4/analytics-ingest-helpers";
import { adminClient } from "../fixtures/auth";
import { dayAt, rollUp } from "../m4/analytics-dash-helpers";
import { ITEMS_LINK, HOME_LINK, addSubPage } from "./analytics-helpers";

/**
 * M11-09: views and clicks are recorded per page of a site. The view beacon carries the sub-page id
 * and `/api/e` refuses (a silent 204, nothing recorded) one that is not a live page of the site the
 * host serves; `/r` finds a block on any page of the site and counts the click for the page that
 * holds it; the nightly rollup keeps the pages apart. Raw HTTP against the dev server, one site per
 * test, on both projects.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

test("M11-09 a view of a live sub-page is stored with its id; Home's has none", async () => {
  const site = await ingestPage("pi1", { plan: "pro" });
  const items = await addSubPage(site, { path: "items" });

  const sub = await postBeacon(site, { pageId: site.pageId, subPageId: items.id, referrer: "" });
  const home = await postBeacon(site, { pageId: site.pageId, referrer: "" });
  expect([sub.status, home.status]).toEqual([204, 204]);

  const rows = await waitForEvents(site.pageId, 2);
  expect(
    rows.filter((r) => (r as { sub_page_id?: string | null }).sub_page_id === items.id),
  ).toHaveLength(1);
  expect(
    rows.filter((r) => (r as { sub_page_id?: string | null }).sub_page_id === null),
  ).toHaveLength(1);
});

test("M11-09 the beacon refuses an id that is a draft, deleted, another site's or not a UUID: the same 204, nothing recorded", async () => {
  const site = await ingestPage("pi2", { plan: "pro" });
  const other = await ingestPage("pi3", { plan: "pro" });
  const draft = await addSubPage(site, { path: "soon", live: false });
  const foreign = await addSubPage(other, { path: "items" });
  const control = await postBeacon(site, { pageId: site.pageId, referrer: "" });

  const statuses: number[] = [];
  for (const subPageId of [draft.id, foreign.id, randomUUID(), "not-a-uuid", 42]) {
    const response = await postBeacon(site, { pageId: site.pageId, subPageId, referrer: "" });
    statuses.push(response.status);
    expect(response.headers["cache-control"]).toBe(control.headers["cache-control"]);
    expect(response.body).toBe("");
  }
  expect(statuses).toEqual([204, 204, 204, 204, 204]);
  expect(await settledCount(site.pageId)).toBe(1); // only the control view

  // A live sub-page id sent from a host that does not serve the site records nothing either.
  const live = await addSubPage(site, { path: "items", title: "Items" });
  await postBeacon(
    site,
    { pageId: site.pageId, subPageId: live.id, referrer: "" },
    { origin: other.origin },
  );
  expect(await settledCount(site.pageId)).toBe(1);

  // Deleting the page makes its id stale at once.
  const gone = await adminClient().from("site_pages").delete().eq("id", live.id);
  expect(gone.error).toBeNull();
  await postBeacon(site, { pageId: site.pageId, subPageId: live.id, referrer: "" });
  expect(await settledCount(site.pageId)).toBe(1);
});

test("M11-09 a click on a sub-page block redirects to its URL and counts for that page", async () => {
  const site = await ingestPage("pi4", { plan: "pro" });
  const items = await addSubPage(site, { path: "items" });

  const sub = await getClick(site, ITEMS_LINK.id);
  expect(sub.status).toBe(302);
  expect(sub.location).toBe("https://example.com/armchair");
  const home = await getClick(site, HOME_LINK.id);
  expect(home.status).toBe(302);

  const clicks = await waitForClicks(site.pageId, 2);
  const byBlock = Object.fromEntries(
    clicks.map((c) => [c.block_id, (c as { sub_page_id?: string | null }).sub_page_id ?? null]),
  );
  expect(byBlock).toEqual({ [ITEMS_LINK.id]: items.id, [HOME_LINK.id]: null });
});

test("M11-09 a block of a draft-only page, or of another site's page, is the usual 404 and counts nothing", async () => {
  const site = await ingestPage("pi5", { plan: "pro" });
  const other = await ingestPage("pi6", { plan: "pro" });
  await addSubPage(site, { path: "soon", live: false });
  await addSubPage(other, { path: "items" });

  expect((await getClick(site, ITEMS_LINK.id)).status).toBe(404);
  expect((await getClick(site, ITEMS_LINK.id, { pageId: other.pageId })).status).toBe(404); // wrong host
  expect(await settledCount(site.pageId)).toBe(0);
  expect(await settledCount(other.pageId, 0)).toBe(0);
});

test("M11-09 the nightly rollup keeps the pages apart", async () => {
  const site = await ingestPage("pi7", { plan: "pro" });
  const items = await addSubPage(site, { path: "items" });
  await postBeacon(site, { pageId: site.pageId, referrer: "" });
  await postBeacon(site, { pageId: site.pageId, subPageId: items.id, referrer: "" });
  await getClick(site, ITEMS_LINK.id);
  await waitForClicks(site.pageId, 1);
  await waitForEvents(site.pageId, 3);

  // Today's events are rolled up like any day (the nightly job does yesterday; the function takes any).
  const today = dayAt(0);
  await rollUp([today]);

  const { data, error } = await adminClient()
    .from("daily_stats")
    .select("sub_page_id, block_id, views, clicks")
    .eq("page_id", site.pageId)
    .eq("day", today);
  expect(error).toBeNull();
  const nil = "00000000-0000-0000-0000-000000000000";
  const key = (r: { sub_page_id: string; block_id: string }) => `${r.sub_page_id}|${r.block_id}`;
  const rows = new Map((data ?? []).map((r) => [key(r), r]));
  expect(rows.get(`${nil}|`)).toMatchObject({ views: 1, clicks: 0 });
  expect(rows.get(`${items.id}|`)).toMatchObject({ views: 1, clicks: 1 });
  expect(rows.get(`${items.id}|${ITEMS_LINK.id}`)).toMatchObject({ clicks: 1 });
  expect(rows.size).toBe(3);
});
