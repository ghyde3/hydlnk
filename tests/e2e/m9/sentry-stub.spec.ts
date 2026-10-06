import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * M9-10 with Sentry ON, against a local stand-in for Sentry. These specs need a server built with the
 * DSN set, so they run only when HL_SENTRY_STUB_PORT names the stub (they are skipped otherwise):
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/e2e/fixtures/sentry-stub-server.ts 12114 &
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3300 NEXT_PUBLIC_SENTRY_DSN=http://stubkey@127.0.0.1:12114/1 pnpm build
 *   HYDLNK_QUERY_COUNTER=1 pnpm exec next start -p 3300 &        (the test hooks make the `hl-fault` cookie work)
 *   HL_DEV_PORT=3300 HL_SENTRY_STUB_PORT=12114 pnpm exec playwright test tests/e2e/m9/sentry-stub.spec.ts
 *
 * What is proven: the SDK loads on the app host after the screen has rendered and moves nothing;
 * a server error on an app screen and a browser error each send ONE envelope with nothing personal
 * in it; the marketing site and a tenant page load no SDK, make no request to Sentry and send nothing.
 */

const STUB = process.env.HL_SENTRY_STUB_PORT ? `http://127.0.0.1:${process.env.HL_SENTRY_STUB_PORT}` : "";

test.skip(!STUB, "needs a build started with NEXT_PUBLIC_SENTRY_DSN set to the stub (see the header)");
test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

interface Envelope {
  n: number;
  receivedAt: number;
  origin: string | null;
  items: Array<{ type: string; payload: Record<string, unknown> }>;
}

async function envelopes(): Promise<Envelope[]> {
  const res = await fetch(`${STUB}/__stub/envelopes`);
  return (await res.json()) as Envelope[];
}

/** Error events (not traces, sessions or client reports) received after envelope number `since`. */
async function errorEventsSince(since: number): Promise<Array<Record<string, unknown>>> {
  return (await envelopes())
    .filter((envelope) => envelope.n >= since)
    .flatMap((envelope) => envelope.items.filter((item) => item.type === "event").map((item) => item.payload));
}

const mark = async (): Promise<number> => (await envelopes()).length;

/** Waits for at least `count` error events after `since`, then a quiet second, and returns all of them. */
async function settle(since: number, count: number): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && (await errorEventsSince(since)).length < count) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return errorEventsSince(since);
}

async function signedIn(context: BrowserContext) {
  return signedInUser(context, { label: "ss", plan: "pro" });
}

/** Records every request and every script body of a page. */
function watch(page: Page) {
  const seen = { requests: [] as string[], scripts: [] as Array<{ url: string; text: string }> };
  page.on("request", (request) => seen.requests.push(request.url()));
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    try {
      seen.scripts.push({ url: response.url(), text: await response.text() });
    } catch {
      // gone with the page
    }
  });
  return seen;
}

const SDK_IN_CODE = /@sentry[+/]|__SENTRY__|sentry\.io\/api|sentry-trace/;

async function layoutShift(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

const SCREENS = ["/editor", "/design", "/share", "/analytics", "/domains"] as const;

test.describe("M9-10 the SDK on the app host", () => {
  for (const screen of SCREENS) {
    test(`M9-10 ${screen}: the SDK loads after the screen has rendered, nothing shifts, nothing is wider than the screen`, async ({ page, context }, info) => {
      await signedIn(context);
      await page.addInitScript(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
            if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const seen = watch(page);
      await page.goto(url("app", screen), { waitUntil: "networkidle" });
      await expect(page.locator("main, [role=main]").first()).toBeVisible();
      await page.waitForTimeout(800);

      // The one place the DSN is used: the SDK's own chunk, fetched after render.
      expect(seen.scripts.some((script) => SDK_IN_CODE.test(script.text)), "the SDK chunk was loaded").toBe(true);
      expect(await layoutShift(page)).toBeLessThanOrEqual(0.01);
      await expectNoHorizontalScroll(page);
      if (phoneOnly(info)) await expectTapTargets(page);
      // No debugging overlay, banner or feedback widget.
      expect(await page.locator('#sentry-feedback, [id^="sentry-"]').count()).toBe(0);
    });
  }
});

test.describe("M9-10 the sign-in page of the app host (no account needed)", () => {
  test("M9-10 /login loads the SDK after render and a browser error there sends one scrubbed envelope, with no request, cookie or user in it", async ({ page }, info) => {
    test.skip(!desktopOnly(info), "one project is enough for a data flow");
    const seen = watch(page);
    await page.goto(url("app", "/login?token=tok-77&email=gary%40example.com"), { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    expect(seen.scripts.some((script) => SDK_IN_CODE.test(script.text)), "the SDK chunk was loaded").toBe(true);
    const since = await mark();
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("boom for gary@example.com at /t/mara?code=zzz via https://app.localhost:3300/share/abcDEF123 with eyJhbGciOi.eyJzdWIiOi.sig12345");
      }, 0);
    });
    const events = await settle(since, 1);
    expect(events).toHaveLength(1);
    const text = JSON.stringify(events[0]);
    expect(text).toContain("boom for [email]");
    for (const personal of ["gary@example.com", "gary%40", "/t/mara", "code=zzz", "abcDEF123", "eyJhbGci", "tok-77"]) {
      expect(text, personal).not.toContain(personal);
    }
    const event = events[0] as { request?: { url?: string; headers?: unknown; cookies?: unknown; query_string?: unknown }; user?: unknown };
    expect(event.user).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.url).toBe(url("app", "/login"));
  });
});

test.describe("M9-10 one scrubbed envelope per error", () => {
  test("M9-10 a server error on an app screen shows the app's own error panel and sends one envelope with nothing personal in it", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "one project is enough for a data flow");
    const user = await signedIn(context);
    await context.addCookies([{ name: "hl-fault", value: "route-throw", url: url("app") }]);
    const since = await mark();
    await page.goto(url("app", `/settings?email=${encodeURIComponent(user.email)}&token=tok-9f3a&code=oauth-1c7d`));
    await expect(page.getByTestId("error-message")).toHaveText("Something went wrong. Try again.");
    await expect(page.getByTestId("error-reference")).toHaveText(/^Reference: [A-Za-z0-9_-]{6,}$/);

    const events = await settle(since, 1);
    expect(events).toHaveLength(1);
    const text = JSON.stringify(events[0]);
    expect(text).toContain("Injected fault: route-throw");
    for (const personal of [user.email, user.handle, "tok-9f3a", "oauth-1c7d", "sb-", "eyJ", "e2e-ss"]) {
      expect(text, personal).not.toContain(personal);
    }
    const event = events[0] as { request?: Record<string, unknown>; user?: unknown; server_name?: unknown };
    expect(event.user).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.request).toEqual({ url: url("app", "/settings"), method: "GET" });
  });

  test("M9-10 a browser error on the app host sends one envelope, scrubbed", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "one project is enough for a data flow");
    const user = await signedIn(context);
    await page.goto(url("app", "/editor"), { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const since = await mark();
    await page.evaluate((email) => {
      setTimeout(() => {
        throw new Error(`boom for ${email} at /t/mara?code=zzz via https://app.localhost:3300/share/abcDEF123 with eyJhbGciOi.eyJzdWIiOi.sig12345`);
      }, 0);
    }, user.email);
    const events = await settle(since, 1);
    expect(events).toHaveLength(1);
    const text = JSON.stringify(events[0]);
    expect(text).toContain("boom for [email]");
    for (const personal of [user.email, "/t/mara", "code=zzz", "abcDEF123", "eyJhbGci", user.handle]) {
      expect(text, personal).not.toContain(personal);
    }
    const event = events[0] as { request?: { url?: string; headers?: unknown; cookies?: unknown }; user?: unknown };
    expect(event.user).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.url).toBe(url("app", "/editor"));
  });
});

test.describe("M9-10 the marketing site and a tenant page", () => {
  for (const [name, target] of [
    ["the marketing site", url()],
    ["a tenant page", url("mara")],
  ] as const) {
    test(`M9-10 ${name}: no SDK, no request to Sentry, and an error thrown there sends nothing`, async ({ page }, info) => {
      test.skip(!desktopOnly(info), "one project is enough");
      const seen = watch(page);
      const since = await mark();
      await page.goto(target, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error("an error on a public page");
        }, 0);
      });
      await page.waitForTimeout(2000);
      expect(seen.requests.filter((u) => u.startsWith(STUB))).toEqual([]);
      expect(seen.scripts.filter((script) => SDK_IN_CODE.test(script.text)).map((s) => s.url)).toEqual([]);
      expect(await errorEventsSince(since)).toEqual([]);
      expect(await page.evaluate(() => "__SENTRY__" in window)).toBe(false);
    });
  }
});
