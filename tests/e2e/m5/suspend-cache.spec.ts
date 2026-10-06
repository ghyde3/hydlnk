import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { rawBuffer, SERVER_PORT, tenantGet } from "../m2/publish-helpers";
import { sessionCookie, signInAsAdmin, signInAsUser } from "./admin-helpers";

/**
 * M5-08, the cache half: against a production build, a cached public page is replaced at once by
 * the 404 when an admin suspends the account (the real `invalidateAccountPages`), and the page is
 * back at once when the account is unsuspended (`invalidateAccountPages` and `invalidateHandle`,
 * so the 5 second cached 404 does not linger). `next dev` never caches a page, so the other M5-08
 * specs cannot see this. Run it like publish-cache.spec.ts:
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 pnpm build
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 pnpm start -p 3100
 *   HL_PROD_PORT=3100 pnpm test:e2e tests/e2e/m5/suspend-cache.spec.ts
 *
 * The shared dev server on :3000 only signs the users in (the session cookie is host-only, not per
 * port); the admin routes run on the production server.
 */

test.skip(!process.env.HL_PROD_PORT, "needs a production build: set HL_PROD_PORT (see the header)");
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.afterAll(cleanupUsers);

const APP_HOST = `app.localhost:${SERVER_PORT}`;
const cacheState = (res: { headers: Record<string, unknown> }) =>
  String(res.headers["x-nextjs-cache"] ?? "");

test("M5-08 a cached page is never served after Suspend, and is back at once after Unsuspend", async ({
  browser,
}) => {
  const owner = await signInAsUser(await browser.newContext(), "scache");
  const adminContext = await browser.newContext();
  await signInAsAdmin(adminContext, "scacheadm");
  const cookie = await sessionCookie(adminContext);
  const post = (path: string) =>
    rawBuffer(APP_HOST, path, {
      method: "POST",
      cookie,
      headers: { "content-type": "application/json", origin: `http://${APP_HOST}` },
      body: "{}",
    });

  // A distinctive display name (no characters HTML would escape) is the page's content marker.
  const marker = `ZqCacheMarker${Date.now().toString(36)}`;
  const admin = adminClient();
  const stored = await admin.from("pages").select("published").eq("id", owner.pageId!).single();
  const doc = JSON.parse(JSON.stringify(stored.data!.published));
  doc.profile.name = marker;
  await admin.from("pages").update({ published: doc }).eq("id", owner.pageId!);

  // Warm the cache: the second read is a HIT with the page's content.
  const first = await tenantGet(owner.handle!);
  const second = await tenantGet(owner.handle!);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(cacheState(second)).toBe("HIT");
  expect(second.text).toContain(marker);
  expect((await tenantGet(owner.handle!, "/og")).status).toBe(200);

  // Suspend, and read at once: the 404, never the cached 200.
  const suspended = await post(`/api/admin/accounts/${owner.userId}/suspend`);
  expect(suspended.status, suspended.text).toBe(200);
  const gone = await tenantGet(owner.handle!);
  expect(gone.status).toBe(404);
  expect(gone.text).toContain("This page isn’t available.");
  expect(gone.text).not.toContain(marker);
  expect((await tenantGet(owner.handle!, "/og")).status).toBe(404);
  // Read it again (it may now be the short-lived cached 404): still the 404.
  expect((await tenantGet(owner.handle!)).status).toBe(404);

  // Unsuspend, and read at once: the page with its original content, not the cached 404.
  const restored = await post(`/api/admin/accounts/${owner.userId}/unsuspend`);
  expect(restored.status, restored.text).toBe(200);
  const back = await tenantGet(owner.handle!);
  expect(back.status).toBe(200);
  expect(back.text).toContain(marker);
  expect(back.text).not.toContain("This page isn’t available.");
  expect((await tenantGet(owner.handle!, "/og")).status).toBe(200);
});
