import type { Browser } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { addViews, rollupDay, utcDay } from "../m4/analytics-db-helpers";
import { signInAsUser } from "./admin-helpers";

/**
 * Helpers for the high-traffic flag specs (M5-10). A flag comes from the real pipeline, with the
 * secret key only: events, the rollup of their day, then flag_high_traffic_pages. The job's default
 * line is 100,000 views; the specs pass a threshold of 1,000 and seed 1,234 views instead, which is
 * the same code path without 100,000 rows. (pgTAP 113 proves the default line.)
 */

export const SEED_VIEWS = 1234;
export const SEED_THRESHOLD = 1000;

export interface FlaggedPage {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
  flagId: string;
  views: number;
}

/** flag_high_traffic_pages(threshold) with the secret key: the number of flags created. */
export async function runFlagJob(threshold = SEED_THRESHOLD): Promise<number> {
  const { data, error } = await adminClient().rpc("flag_high_traffic_pages", { threshold });
  if (error) throw new Error(`flag_high_traffic_pages failed: ${error.message}`);
  return data as number;
}

/** The page's newest flag, or null. */
export async function flagOf(
  pageId: string,
): Promise<{ id: string; views: number; reviewed_at: string | null; flagged_at: string } | null> {
  const { data, error } = await adminClient()
    .from("traffic_flags")
    .select("id, views, reviewed_at, flagged_at")
    .eq("page_id", pageId)
    .order("flagged_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`flagOf failed: ${error.message}`);
  return (data?.[0] as never) ?? null;
}

/**
 * A fresh Free user with a published page, SEED_VIEWS views yesterday, rolled up and flagged.
 * The owner signs in on a context of their own (the caller's context stays free for the admin).
 */
export async function seedFlaggedPage(browser: Browser, label: string): Promise<FlaggedPage> {
  const ownerContext = await browser.newContext();
  try {
    const owner = await signInAsUser(ownerContext, label);
    const day = utcDay(1);
    await addViews(owner.pageId!, day, SEED_VIEWS);
    await rollupDay(day);
    await runFlagJob();
    const flag = await flagOf(owner.pageId!);
    if (!flag) throw new Error(`seedFlaggedPage: ${owner.handle} was not flagged`);
    return {
      userId: owner.userId,
      email: owner.email,
      handle: owner.handle!,
      pageId: owner.pageId!,
      flagId: flag.id,
      views: flag.views,
    };
  } finally {
    await ownerContext.close();
  }
}
