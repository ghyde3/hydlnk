import { expect, test } from "@playwright/test";
import { url } from "../helpers";
import { signInAs } from "../fixtures/auth";
import { uniq } from "../fixtures/data";
import {
  appRaw,
  authCookies,
  cookieHeader,
  decodeSession,
  encodeSessionCookie,
  isAuthCookie,
  NEVER_STORED,
  rawRequest,
  sessionOf,
} from "../fixtures/http";

const addr = (label: string, project: string) => `${uniq(label)}-${project}@example.com`;
const handleFor = (label: string, project: string) => `${uniq(label)}-${project[0]}`.slice(0, 30);

/** Cookie header for the app host from everything the context holds for it. */
async function appCookieHeader(
  context: import("@playwright/test").BrowserContext,
): Promise<string> {
  return cookieHeader(await context.cookies("http://app.localhost:3000"));
}

test.describe("M1-06 session cookies are host-only on the app host; auth routes exist on the app host only", () => {
  test("M1-06 the auth cookie is host-only app.localhost, Path=/, SameSite=Lax", async ({
    context,
  }, testInfo) => {
    await signInAs(context, addr("ck", testInfo.project.name));
    const cookies = await authCookies(context);
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.name).toMatch(/^sb-.+-auth-token(\.\d+)?$/);
      expect(cookie.domain, "no Domain attribute: host-only").toBe("app.localhost");
      expect(cookie.path).toBe("/");
      expect(cookie.sameSite).toBe("Lax");
    }
    // Nothing for the tenant or marketing hosts.
    for (const host of [null, "mara", "zq-other"]) {
      expect((await context.cookies(url(host))).filter((c) => c.name.startsWith("sb-"))).toEqual(
        [],
      );
    }
  });

  test("M1-06 tenant and marketing hosts carry no sb- cookie, set no cookie, and never call the auth URL", async ({
    page,
    context,
  }, testInfo) => {
    await signInAs(context, addr("ck-hosts", testInfo.project.name));
    const authCalls: string[] = [];
    page.on("request", (r) => {
      if (/:54321\/auth\//.test(r.url())) authCalls.push(r.url());
    });
    for (const target of [url("mara"), url()]) {
      const response = await page.goto(target);
      expect(response!.status()).toBe(200);
      const requestHeaders = await response!.request().allHeaders();
      expect(requestHeaders.cookie ?? "").not.toContain("sb-");
      const responseHeaders = await response!.allHeaders();
      expect(responseHeaders["set-cookie"], target).toBeUndefined();
    }
    expect(authCalls).toEqual([]);
  });

  const APP_ONLY = [
    "/login",
    "/signup",
    "/claim",
    "/auth/callback",
    "/editor",
    "/design",
    "/analytics",
    "/domains",
    "/settings",
    "/api/handles/check",
  ];

  test("M1-06 tenant host: every app path is a 404", async () => {
    for (const path of APP_ONLY) {
      expect((await rawRequest("mara.localhost:3000", path)).status, `mara ${path}`).toBe(404);
    }
  });

  test("M1-06 root host: 404 for app paths, 308 to the app host for /login and /signup with the query kept", async ({}) => {
    for (const path of APP_ONLY.filter((p) => p !== "/login" && p !== "/signup")) {
      expect((await rawRequest("localhost:3000", path)).status, `root ${path}`).toBe(404);
    }
    for (const path of ["/login", "/signup"]) {
      const res = await rawRequest("localhost:3000", `${path}?handle=zq-keep&x=1`);
      expect(res.status, `root ${path}`).toBe(308);
      expect(res.location).toBe(`http://app.localhost:3000${path}?handle=zq-keep&x=1`);
    }
  });

  test("M1-06 persistence: a context restored from storageState is still signed in", async ({
    browser,
    context,
  }, testInfo) => {
    const { handle } = await signInAs(context, addr("persist", testInfo.project.name), {
      handle: handleFor("pe", testInfo.project.name),
    });
    const state = await context.storageState();
    const restored = await browser.newContext({ storageState: state });
    try {
      const page = await restored.newPage();
      await page.goto(url("app", "/"));
      expect(new URL(page.url()).pathname).not.toBe("/login");
      expect(new URL(page.url()).pathname).toBe("/editor"); // signed in with a page: the gate lands here
      expect(handle).toBeTruthy();
    } finally {
      await restored.close();
    }
  });

  test("M1-06 abuse: replaying a valid auth cookie on tenant and root hosts changes nothing", async ({
    context,
  }, testInfo) => {
    const email = addr("replay", testInfo.project.name);
    await signInAs(context, email);
    const cookie = await appCookieHeader(context);
    const session = await sessionOf(context);
    expect(cookie).toContain("sb-");

    for (const host of ["mara.localhost:3000", "localhost:3000"]) {
      // The first request to a route compiles it in `next dev` and its HTML can differ a little
      // from the later ones (asset links), so warm the route up, then bracket the request that
      // carries the cookie between two that do not: it must look like either of them.
      await rawRequest(host, "/");
      const without = await rawRequest(host, "/");
      const withCookie = await rawRequest(host, "/", { cookie });
      const withoutAfter = await rawRequest(host, "/");
      expect(withCookie.status).toBe(without.status);
      expect(withCookie.setCookies, `${host} sets nothing`).toEqual([]);
      expect(withCookie.body).not.toContain(email);
      expect(withCookie.body).not.toContain(session.user!.id);
      expect([without.body.length, withoutAfter.body.length]).toContain(withCookie.body.length);
    }

    // The app host would refresh a session whose access token is past expiry (control) ...
    const expired = encodeSessionCookie({
      ...decodeSession(await authCookies(context)),
      expires_at: 1,
    });
    const appResponse = await appRaw("/login", { cookie: expired });
    expect(appResponse.setCookies.some((c) => isAuthCookie(c.split("=")[0]!))).toBe(true);
    // ... but the other hosts never touch the session, even when it needs a refresh.
    for (const host of ["mara.localhost:3000", "localhost:3000"]) {
      const res = await rawRequest(host, "/", { cookie: expired });
      expect(res.setCookies, `${host} must not refresh`).toEqual([]);
    }
  });
});

test.describe("M1-07 auth gate and landing redirects for app routes", () => {
  const GATED = ["/", "/editor", "/design", "/analytics", "/domains", "/settings", "/claim"];
  const SCREENS = ["/editor", "/design", "/analytics", "/domains", "/settings"];
  const pathOf = (location: string | null) =>
    location ? new URL(location, "http://app.localhost:3000").pathname : null;

  test("M1-07 signed out: every gated route redirects to /login; /login and /signup render", async ({}) => {
    for (const path of GATED) {
      const res = await appRaw(path);
      expect([307, 308], path).toContain(res.status);
      expect(res.location, path).toMatch(/^(http:\/\/app\.localhost:3000)?\/login$/);
    }
    for (const path of ["/login", "/signup"]) expect((await appRaw(path)).status).toBe(200);
  });

  test("M1-07 signed in without a page: everything goes to /claim, /claim renders", async ({
    context,
  }, testInfo) => {
    await signInAs(context, addr("gate-none", testInfo.project.name));
    const cookie = await appCookieHeader(context);
    for (const path of ["/", ...SCREENS]) {
      const res = await appRaw(path, { cookie });
      expect([307, 308], path).toContain(res.status);
      expect(pathOf(res.location), path).toBe("/claim");
    }
    expect((await appRaw("/claim", { cookie })).status).toBe(200);
  });

  test("M1-07 signed in with a page: / and /login, /signup, /claim go to /editor", async ({
    context,
  }, testInfo) => {
    await signInAs(context, addr("gate-page", testInfo.project.name), {
      handle: handleFor("gp", testInfo.project.name),
    });
    const cookie = await appCookieHeader(context);
    for (const path of ["/", "/login", "/signup", "/claim"]) {
      const res = await appRaw(path, { cookie });
      expect([307, 308], path).toContain(res.status);
      expect(res.location, path).toMatch(/^(http:\/\/app\.localhost:3000)?\/editor$/);
    }
  });

  test("M1-07 abuse: a forged cookie holding a garbage JWT is signed out", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const forged = encodeSessionCookie({
      access_token:
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwYTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.forged",
      refresh_token: "garbage",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: future,
      user: { id: "00000000-0000-4000-8000-0000000000a1", email: "mara@example.test" },
    });
    for (const cookie of [
      forged,
      "sb-127-auth-token=garbage",
      "sb-127-auth-token=base64-bm90LWpzb24",
    ]) {
      for (const path of ["/", "/editor", "/settings", "/claim"]) {
        const res = await appRaw(path, { cookie });
        expect([307, 308], `${cookie.slice(0, 30)} ${path}`).toContain(res.status);
        expect(pathOf(res.location)).toBe("/login");
      }
      expect((await appRaw("/login", { cookie })).status).toBe(200);
    }
  });

  // Strict `no-store` comes from the proxy (src/lib/routing/session.ts). It is asserted in
  // tests/unit/routing-session.test.ts and, against a production build, by running this file with
  // E2E_PROD_BUILD=1 (see NEVER_STORED). The back button after sign-out is in auth-signout.spec.ts.
  test("M1-07 signed-in app responses are never stored (Cache-Control no-store)", async ({
    context,
  }, testInfo) => {
    await signInAs(context, addr("gate-cc", testInfo.project.name), {
      handle: handleFor("cc", testInfo.project.name),
    });
    const cookie = await appCookieHeader(context);
    for (const path of [
      "/",
      "/editor",
      "/design",
      "/analytics",
      "/domains",
      "/settings",
      "/login",
    ]) {
      const res = await appRaw(path, { cookie });
      expect(res.headers["cache-control"] ?? "", path).toMatch(NEVER_STORED);
    }
  });

  test("M1-07 no return-URL parameter is read or produced", async ({ context }, testInfo) => {
    // Signed out: /login and /signup ignore ?next=, ?redirect_to=, ?return_to= entirely.
    const query =
      "next=https://evil.example/x&redirect_to=https://evil.example/y&return_to=/settings";
    for (const path of ["/login", "/signup"]) {
      const res = await appRaw(`${path}?${query}`);
      expect(res.status).toBe(200);
      // (Next echoes the query in its own flight payload; what matters is that no link or form uses it.)
      expect(res.body).not.toMatch(
        /\s(href|action)="[^"]*(evil\.example|next=|redirect_to=|return_to=)/,
      );
    }
    // Signed out: gate redirects carry no query at all.
    for (const path of GATED) {
      const res = await appRaw(`${path}?${query}`);
      expect(res.location, path).not.toContain("?");
    }
    // Signed in: the same parameters change nothing.
    await signInAs(context, addr("gate-ret", testInfo.project.name), {
      handle: handleFor("rt", testInfo.project.name),
    });
    const cookie = await appCookieHeader(context);
    for (const path of ["/login", "/signup", "/claim", "/"]) {
      const res = await appRaw(`${path}?${query}`, { cookie });
      expect(pathOf(res.location), path).toBe("/editor");
      expect(res.location).not.toContain("?");
    }
  });
});
