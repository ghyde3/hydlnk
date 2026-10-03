import type { BrowserContext, Page } from "@playwright/test";
import { adminClient, type Plan } from "../fixtures/auth";
import { makeUser, signIn } from "../fixtures/data";
import { url } from "../helpers";

/**
 * Shared setup for the Analytics screen specs (M4-26..M4-30, M5-17). Data goes in the way
 * production gets it: raw `events` rows (the secret key may insert them), then the real nightly
 * rollup (`rollup_daily_stats`, service_role only) turns past days into `daily_stats` and
 * `daily_dim_stats`. Nothing here writes the rollup tables directly (nobody can).
 *
 * Each helper takes a page id, and every spec makes its own users and pages (cleanupUsers removes
 * them, their events and rollup rows with them), so specs never share or touch seed data.
 */

export const DAY_MS = 86_400_000;

/** The UTC day `offset` days from today (negative = past), "YYYY-MM-DD". */
export function dayAt(offset: number, now = new Date()): string {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight + offset * DAY_MS).toISOString().slice(0, 10);
}

/** "Sep 12": written with the platform's own formatter, independent of the app's labels. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Sep 1 – Sep 30, 2026" for the window of `days` days ending today. */
export function windowLabel(days: number, now = new Date()): string {
  const end = dayAt(0, now);
  const start = dayAt(-(days - 1), now);
  const year = (day: string) => day.slice(0, 4);
  const first = year(start) === year(end) ? shortDay(start) : `${shortDay(start)}, ${year(start)}`;
  return `${first} – ${shortDay(end)}, ${year(end)}`;
}

/** The clickable things of the copied demo page (seed.sql), by id and the name the table shows. */
export const LINKS = {
  portrait: { id: "Bt5rJ1fGz6Os", label: "Portrait sessions — fall dates" },
  studio: { id: "Qw8vC2nKd4Ly", label: "Studio rental by the hour" },
  night: { id: "Lc6hP0yRe3Zi", label: "Night Market" },
  prints: { id: "Cp9kA3wMx1Qe", label: "Prints" },
  instagram: { id: "Ig3xQ7mNa2Ks", label: "Instagram" },
} as const;

/** A block id that is in no published document: its clicks read "Removed link". */
export const GONE_BLOCK = "GoneBlock01";

export interface SeedEvent {
  type: "view" | "click";
  /** UTC day; with `hour` it is the event's time. */
  day?: string;
  hour?: number;
  /** An exact time instead (today's events use the real clock, so they are never in the future). */
  ts?: string;
  blockId?: string;
  visitor: string;
  /** null = none; undefined = the defaults below. */
  referrer?: string | null;
  device?: string | null;
  country?: string | null;
}

/** Inserts raw events for a page with the secret key. Defaults: direct visit, mobile, US. */
export async function insertEvents(pageId: string, events: readonly SeedEvent[]): Promise<void> {
  const rows = events.map((event) => ({
    page_id: pageId,
    block_id: event.type === "view" ? "" : (event.blockId ?? LINKS.portrait.id),
    type: event.type,
    ts: event.ts ?? `${event.day}T${String(event.hour ?? 12).padStart(2, "0")}:00:00Z`,
    referrer: event.referrer === undefined ? null : event.referrer,
    device: event.device === undefined ? "mobile" : event.device,
    country: event.country === undefined ? "US" : event.country,
    visitor_hash: event.visitor,
  }));
  for (let from = 0; from < rows.length; from += 400) {
    const { error } = await adminClient()
      .from("events")
      .insert(rows.slice(from, from + 400));
    if (error) throw new Error(`inserting events failed: ${error.message}`);
  }
}

/** Runs the nightly rollup for each distinct day (what pg_cron does at 00:10 UTC). */
export async function rollUp(days: readonly string[]): Promise<void> {
  for (const day of new Set(days)) {
    for (let attempt = 1; ; attempt++) {
      const { error } = await adminClient().rpc("rollup_daily_stats", { p_day: day });
      if (!error) break;
      if (attempt >= 4) throw new Error(`rollup_daily_stats(${day}) failed: ${error.message}`);
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

/** Events, then the rollup of every past day among them: yesterday and before are daily rows. */
export async function seed(pageId: string, events: readonly SeedEvent[]): Promise<void> {
  await insertEvents(pageId, events);
  const today = dayAt(0);
  await rollUp(events.flatMap((e) => (e.day && e.day < today ? [e.day] : [])));
}

/** Adds a copy of the demo page's documents as `handle`, owned by `ownerId`. Returns the page id. */
export async function createPublishedPage(
  ownerId: string,
  handle: string,
  opts: { published?: boolean } = {},
): Promise<string> {
  const admin = adminClient();
  const mara = await admin.from("pages").select("draft, published").eq("handle", "mara").single();
  if (mara.error) throw new Error(`seed page 'mara' missing: ${mara.error.message}`);
  const rename = (doc: unknown) => {
    const copy = JSON.parse(JSON.stringify(doc));
    copy.profile.name = handle;
    return copy;
  };
  const published = opts.published !== false;
  const inserted = await admin
    .from("pages")
    .insert({
      owner_id: ownerId,
      handle,
      draft: rename(mara.data.draft),
      published: published ? rename(mara.data.published) : null,
      published_at: published ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(`creating page ${handle} failed: ${inserted.error.message}`);
  return inserted.data.id as string;
}

export interface Owner {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
}

let counter = 0;

/** A fresh user on `plan` with one page (published unless asked otherwise); removed by cleanupUsers. */
export async function makeOwner(
  label: string,
  plan: Plan,
  opts: { published?: boolean } = {},
): Promise<Owner> {
  const user = await makeUser(`ad-${label}`, { plan });
  const handle = `zq-ad-${label}-${Date.now().toString(36)}${(counter++).toString(36)}`.slice(
    0,
    30,
  );
  const pageId = await createPublishedPage(user.id, handle, opts);
  return { userId: user.id, email: user.email, handle, pageId };
}

/** Signs `context` in as an existing owner (their page is then the current one). */
export async function signInOwner(context: BrowserContext, owner: Owner): Promise<void> {
  await signIn(context, owner.email);
}

export const ANALYTICS = () => url("app", "/analytics");

/** The text of a KPI ("Views", "Clicks", "Click-through", "Unique visitors"). */
export async function kpi(page: Page, label: string): Promise<string> {
  const item = page
    .getByTestId("kpi-strip")
    .locator("div", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .first();
  return (await item.locator("dd").innerText()).trim();
}

/** How many events, daily_stats and daily_dim_stats rows a page has (the secret key reads all). */
export async function rowCounts(pageId: string) {
  const admin = adminClient();
  const count = async (table: string) => {
    const { count: n, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("page_id", pageId);
    if (error) throw new Error(`counting ${table} failed: ${error.message}`);
    return n ?? 0;
  };
  return {
    events: await count("events"),
    dailyStats: await count("daily_stats"),
    dailyDims: await count("daily_dim_stats"),
  };
}
