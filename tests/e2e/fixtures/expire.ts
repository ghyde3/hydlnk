import { expect, type Browser } from "@playwright/test";
import {
  CUSTOM_DOMAIN_FOUND_SECONDS,
  CUSTOM_DOMAIN_NONE_SECONDS,
} from "@/lib/routing/custom-domain";
import { adminClient } from "./auth";
import {
  postApp,
  sessionCookie,
  signInAsAdmin,
  suspendPath,
  unsuspendPath,
} from "../m5/admin-helpers";
import { PRODUCTION_BUILD } from "./http";

/**
 * For the specs that change data straight in the database, or through the product's own functions
 * run in the test process, and then expect the very next request to the server to show it (M9-13).
 *
 * `next dev` caches nothing, so the next request always shows it. A production build, which CI's
 * browser suite now runs on, serves a page, its OG image, the /r click target and the custom-host
 * lookup from the cache. The product expires an entry where the change really happens (Publish, the
 * Stripe webhook, an admin Suspend, a Server Action in the server's own process); a write behind the
 * server's back never does, and the server holds the entry until it expires by itself.
 */

/** Runs `body` with a throwaway admin's session cookie (a fresh browser context, closed after). */
async function asAdmin(browser: Browser, body: (cookie: string) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  try {
    await signInAsAdmin(context, "xp");
    await body(await sessionCookie(context));
  } finally {
    await context.close();
  }
}

async function adminPost(path: string, cookie: string): Promise<void> {
  const res = await postApp(path, { cookie });
  expect(res.status, `${path}: ${res.body}`).toBe(200);
}

/**
 * Expires the cached public pages of an owner the way the product does, with no hook of its own: a
 * throwaway admin Suspends and then Unsuspends the account (`invalidateAccountPages`, the call the
 * Stripe webhook makes too), which expires the tag of every page the account owns: the page, its OG
 * image and its click target. Nothing changes in the end. On the dev server it returns at once.
 */
export async function expireOwnerPages(browser: Browser, ownerId: string): Promise<void> {
  if (!PRODUCTION_BUILD) return;
  await asAdmin(browser, async (cookie) => {
    await adminPost(suspendPath(ownerId), cookie);
    await adminPost(unsuspendPath(ownerId), cookie);
  });
}

/**
 * Suspends or unsuspends an account so the server sees it at once. The dev server reads the database
 * on every request, so a write is enough; a production build needs the admin action, which expires
 * the account's cached pages (and refuses nothing a test needs).
 */
export async function setOwnerSuspended(
  browser: Browser,
  ownerId: string,
  suspended: boolean,
): Promise<void> {
  if (!PRODUCTION_BUILD) {
    const { error } = await adminClient()
      .from("accounts")
      .update({ suspended_at: suspended ? new Date().toISOString() : null })
      .eq("id", ownerId);
    expect(error).toBeNull();
    return;
  }
  await asAdmin(browser, (cookie) =>
    adminPost(suspended ? suspendPath(ownerId) : unsuspendPath(ownerId), cookie),
  );
}

/**
 * Reads until `settled` holds, for a change the test made behind the server's back (in its own
 * process: a domain row written or removed, a Server Action core run here) to a custom host. The
 * dev server shows it on the first read. A production build remembers a host for `found` (a page id,
 * 60 s) or `none` (no verified domain, 10 s) seconds from when it stored it, and only the server
 * process can expire it early, so this reads once a second for that long plus a margin. It returns
 * the last read either way, so the spec's own assertion names the failure.
 */
export async function untilHostLookupExpires<T>(
  read: () => Promise<T>,
  settled: (value: T) => boolean,
  remembered: "found" | "none",
): Promise<T> {
  const seconds = remembered === "found" ? CUSTOM_DOMAIN_FOUND_SECONDS : CUSTOM_DOMAIN_NONE_SECONDS;
  const deadline = Date.now() + (PRODUCTION_BUILD ? (seconds + 5) * 1_000 : 0);
  for (;;) {
    const value = await read();
    if (settled(value) || Date.now() >= deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
