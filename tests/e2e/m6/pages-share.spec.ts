import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, signedInUser } from "../fixtures/data";
import { NEVER_STORED, rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { ITEMS, makeLiveSite } from "../m11/tenant-helpers";
import {
  INACTIVE,
  expireLink,
  getShare,
  linkRows,
  makeLink,
  randomIp,
  revokeLink,
  visibleText,
  withoutRequestSpecifics,
} from "./pages-helpers";

/**
 * M6-09 and M6-10: the shared preview page and the direct-API side of the preview links. Every spec
 * makes its own users and its own client IP, so nothing depends on a quiet minute and nothing
 * touches mara. Raw HTTP specs run once (desktop project); the browser ones run at both viewports.
 */

test.afterAll(cleanupUsers);

const DRAFT_ONLY = "DRAFT-ONLY-7f3a";

/** A published page copied from mara's whose saved draft has a string the live page does not. */
async function ownerWithDraftOnly(
  context: import("@playwright/test").BrowserContext,
  plan?: "free" | "pro",
) {
  const owner = await signedInUser(context, { label: "shr", plan });
  const admin = adminClient();
  const row = await admin.from("pages").select("draft").eq("id", owner.pageId).single();
  const draft = row.data!.draft as { profile: { bio: string } };
  draft.profile.bio = `${DRAFT_ONLY} bio`;
  await admin.from("pages").update({ draft }).eq("id", owner.pageId);
  return owner;
}

test.describe("M6-10 the shared page, over HTTP", () => {
  test("M6-10 a valid link answers 200 with no session, the draft as saved, the right title and bar, and the headers", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    const res = await getShare(link.token, randomIp());

    expect(res.status).toBe(200);
    const text = visibleText(res.body);
    expect(res.body).toContain(`<title>Preview of ${owner.handle}</title>`);
    expect(text).toContain("Draft preview. Not published yet.");
    const expires = new Date(link.expiresAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    expect(text).toContain(`This link expires ${expires}.`);
    expect(res.body).toMatch(/role="status"/);
    // The draft is shown; the owner's plan decides the badge; there is no report link.
    expect(text).toContain(DRAFT_ONLY);
    expect(text).toContain("Made with HYDLNK");
    expect(text).not.toContain("Report this page");

    // The headers.
    expect(res.headers["cache-control"]).toMatch(NEVER_STORED);
    // `next dev` rewrites the header of a rendered page; a production build (E2E_PROD_BUILD=1, see
    // fixtures/http.ts) keeps the proxy's exact value.
    if (process.env.E2E_PROD_BUILD === "1") {
      expect(res.headers["cache-control"]).toBe("private, no-store");
    }
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // The four tenant directives, then the script policy with this request's nonce.
    const csp = String(res.headers["content-security-policy"]);
    expect(
      csp.startsWith(
        "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; img-src 'self' http://localhost:3000; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; ",
      ),
    ).toBe(true);
    expect(csp).toMatch(/; script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(res.headers["x-nextjs-cache"]).toBeUndefined();
    expect(res.setCookies).toEqual([]);
    // A robots meta tag, and no Open Graph or Twitter tags.
    expect(res.body).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(res.body).not.toMatch(/property="og:|name="twitter:/);
  });

  test("M6-10 a Pro owner's page has no badge, and the draft string never shows on the live page", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context, "pro");
    const link = await makeLink(owner.userId, owner.pageId);
    const res = await getShare(link.token, randomIp());
    expect(res.status).toBe(200);
    const text = visibleText(res.body);
    expect(text).toContain(DRAFT_ONLY);
    expect(text).not.toContain("Made with HYDLNK");
    expect(text).not.toContain("Report this page");

    // The live page of the same account never has it (the published copy is what it shows).
    const live = await rawRequest(`${owner.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).not.toContain(DRAFT_ONLY);
    // And mara's page, in case the string ever leaked across accounts.
    const mara = await rawRequest("mara.localhost:3000", "/");
    expect(mara.body).not.toContain(DRAFT_ONLY);
  });

  test("M6-10 no snapshot: an edit after the link was made shows on the next request", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    const ip = randomIp();
    expect(visibleText((await getShare(link.token, ip)).body)).toContain(DRAFT_ONLY);

    const admin = adminClient();
    const row = await admin.from("pages").select("draft").eq("id", owner.pageId).single();
    const draft = row.data!.draft as { profile: { bio: string } };
    draft.profile.bio = "A new bio written after the link was made";
    await admin.from("pages").update({ draft }).eq("id", owner.pageId);
    const after = visibleText((await getShare(link.token, ip)).body);
    expect(after).toContain("A new bio written after the link was made");
    expect(after).not.toContain(DRAFT_ONLY);
  });

  test("M6-10 a signed-in owner opening the link gets no Set-Cookie, and the link works for another user and signed out", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    const cookies = (await context.cookies(url("app")))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    expect(cookies).toContain("sb-");
    const withSession = await getShare(link.token, randomIp(), { cookie: cookies });
    expect(withSession.status).toBe(200);
    expect(withSession.setCookies).toEqual([]);
    const signedOut = await getShare(link.token, randomIp());
    expect(signedOut.status).toBe(200);
    expect(signedOut.setCookies).toEqual([]);
  });

  test("M6-10 every link that is not active answers the same 404 with the same words and no page content", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context);
    const other = await signedInUser(context, { label: "shr2" });
    const ip = randomIp();

    const turnedOff = await makeLink(owner.userId, owner.pageId);
    await revokeLink(turnedOff.id);
    const expired = await makeLink(owner.userId, owner.pageId);
    await expireLink(expired.id);
    const suspended = await makeLink(other.userId, other.pageId);
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", other.userId);
    const deleted = await signedInUser(context, { label: "shr3" });
    const deletedLink = await makeLink(deleted.userId, deleted.pageId);
    expect((await getShare(deletedLink.token, ip)).status).toBe(200);
    expect((await adminClient().from("pages").delete().eq("id", deleted.pageId)).error).toBeNull();

    const cases: [string, string][] = [
      ["unknown token", "Z".repeat(43)],
      ["malformed: abc", "abc"],
      ["malformed: 100 characters", "a".repeat(100)],
      ["malformed: 42 characters", "a".repeat(42)],
      ["malformed: 44 characters", "a".repeat(44)],
      ["malformed: dots", "..%2Fx"],
      ["expired", expired.token],
      ["turned off", turnedOff.token],
      ["suspended owner", suspended.token],
      ["deleted page", deletedLink.token],
    ];
    const responses = new Map<string, Awaited<ReturnType<typeof getShare>>>();
    for (const [label, token] of cases) {
      const res = await getShare(token, ip);
      responses.set(label, res);
      expect(res.status, label).toBe(404);
      expect(res.setCookies, label).toEqual([]);
      expect(res.headers["x-robots-tag"], label).toBe("noindex, nofollow");
      expect(res.headers["referrer-policy"], label).toBe("no-referrer");
      expect(res.headers["cache-control"], label).toMatch(NEVER_STORED);
      expect(res.body, label).toContain(INACTIVE);
      // Nothing of any page: not a name, a bio, a handle or the draft string.
      for (const secret of [
        owner.handle,
        other.handle,
        deleted.handle,
        DRAFT_ONLY,
        "Made with HYDLNK",
      ]) {
        expect(res.body, `${label} leaks ${secret}`).not.toContain(secret);
      }
    }
    // The same visible words for every cause.
    const words = new Set([...responses.values()].map((res) => visibleText(res.body)));
    expect(words.size).toBe(1);
    // And the same markup, once what is different on every request is taken out of it.
    const groups = new Map<string, string[]>();
    for (const [label, token] of cases) {
      const key = withoutRequestSpecifics(responses.get(label)!.body, token);
      groups.set(key, [...(groups.get(key) ?? []), label]);
    }
    expect([...groups.values()], "responses that differ").toHaveLength(1);

    // The suspended owner's link works again after the unsuspend.
    await adminClient().from("accounts").update({ suspended_at: null }).eq("id", other.userId);
    expect((await getShare(suspended.token, ip)).status).toBe(200);
  });

  test("M6-10 turning a link off makes the very next request a 404 (nothing is cached)", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    const ip = randomIp();
    expect((await getShare(link.token, ip)).status).toBe(200);
    expect((await getShare(link.token, ip)).status).toBe(200);
    await revokeLink(link.id);
    expect((await getShare(link.token, ip)).status).toBe(404);
  });

  test("M6-10 a token for page A never draws page B: a query string and a ?page= parameter are ignored, an extra path is a sub-page or the 404 (M12-12)", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const a = await ownerWithDraftOnly(context);
    const b = await signedInUser(context, { label: "shrb" });
    const admin = adminClient();
    const rowB = await admin.from("pages").select("draft").eq("id", b.pageId).single();
    const draftB = rowB.data!.draft as { profile: { name: string; bio: string } };
    draftB.profile.name = "Page B Only Name";
    draftB.profile.bio = "Page B only bio";
    await admin.from("pages").update({ draft: draftB }).eq("id", b.pageId);
    const linkA = await makeLink(a.userId, a.pageId);
    const linkB = await makeLink(b.userId, b.pageId);
    const ip = randomIp();

    // Query strings and ?page= are ignored: the token's own page is drawn, never B's.
    for (const rest of [`?page=${b.pageId}`, `?token=${linkB.token}&page=${b.pageId}`]) {
      const res = await getShare(linkA.token, ip, { rest });
      expect(res.status, rest).toBe(200);
      const text = visibleText(res.body);
      expect(text, rest).toContain(DRAFT_ONLY);
      expect(text, rest).not.toContain("Page B Only");
    }
    // M12-12 supersedes "an extra path is ignored": an extra path names a sub-page of the same site,
    // so an unknown or two-segment path (or another site's token) is the share preview's 404.
    for (const rest of [`/extra/path`, `/extra`, `/${linkB.token}`, `/${b.pageId}`]) {
      const res = await getShare(linkA.token, ip, { rest });
      expect(res.status, rest).toBe(404);
      expect(visibleText(res.body), rest).not.toContain("Page B Only");
      expect(visibleText(res.body), rest).not.toContain(DRAFT_ONLY);
    }
    // A real sub-page path of the same site draws that site's draft, and still never page B.
    const site = await makeLiveSite("shs", { live: false });
    const siteLink = await makeLink(site.user.id, site.pageId);
    const sub = await getShare(siteLink.token, ip, { rest: `/${ITEMS.path}` });
    expect(sub.status).toBe(200);
    expect(visibleText(sub.body)).toContain(ITEMS.title);
    expect(visibleText(sub.body)).not.toContain("Page B Only");
    const viewB = visibleText((await getShare(linkB.token, ip)).body);
    expect(viewB).toContain("Page B only bio");
    expect(viewB).not.toContain(DRAFT_ONLY);
  });

  test("M6-10 no tracking: ten visits add no event, and the page carries no beacon", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    const admin = adminClient();
    const count = async () => {
      const { count: n, error } = await admin
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("page_id", owner.pageId);
      expect(error).toBeNull();
      return n ?? 0;
    };
    const before = await count();
    for (let i = 0; i < 10; i++) {
      const res = await getShare(link.token, randomIp());
      expect(res.status).toBe(200);
      expect(res.body).not.toContain("/api/e");
    }
    // Give a stray beacon a moment to land before comparing.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await count()).toBe(before);
  });

  test("M6-10 the limit is 60 a minute per IP: the 61st is 429 with Retry-After and the plain page; another IP is unaffected", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    test.setTimeout(180_000);
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    const ip = randomIp();
    const other = randomIp();

    const statuses: number[] = [];
    for (let start = 0; start < 60; start += 6) {
      const batch = await Promise.all(
        Array.from({ length: 6 }, () => getShare(link.token, ip).then((res) => res.status)),
      );
      statuses.push(...batch);
    }
    expect(
      statuses.every((status) => status === 200),
      statuses.join(","),
    ).toBe(true);

    const limited = await getShare(link.token, ip);
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(limited.body).toContain(INACTIVE);
    expect(limited.setCookies).toEqual([]);
    expect(limited.headers["cache-control"]).toMatch(NEVER_STORED);
    expect(limited.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(limited.body).not.toContain(owner.handle);

    expect((await getShare(link.token, other)).status).toBe(200);
  });

  test("M6-10 guessing tokens is stopped by the same limit: random 43 character tokens are 404 until the 429", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    test.setTimeout(180_000);
    const ip = randomIp();
    const random = () =>
      Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString(
        "base64url",
      );
    const statuses: number[] = [];
    for (let start = 0; start < 66; start += 6) {
      const batch = await Promise.all(
        Array.from({ length: 6 }, () => getShare(random(), ip).then((res) => res.status)),
      );
      statuses.push(...batch);
    }
    expect(statuses.filter((status) => status === 404)).toHaveLength(60);
    expect(statuses.filter((status) => status === 429)).toHaveLength(6);
  });
});

test.describe("M6-09 the table has no client access", () => {
  test("M6-09 with the owner's JWT and the publishable key, GET, POST, PATCH and DELETE on /rest/v1/preview_links all fail, and nothing is planted, read or revived", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    await revokeLink(link.id);
    const token = await accessTokenFor(owner.email);
    const headers = {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    const rest = `${supabaseUrl()}/rest/v1/preview_links`;
    const denied = async (res: Response) => {
      // Permission denied (401 or 403), or an empty result; never a row.
      const text = await res.text();
      if (res.ok) expect(text === "[]" || text === "", text).toBe(true);
      else expect([401, 403]).toContain(res.status);
      expect(text).not.toContain(link.id);
    };

    await denied(await fetch(`${rest}?select=*`, { headers }));
    await denied(await fetch(`${rest}?select=token_hash`, { headers }));
    await denied(
      await fetch(rest, {
        method: "POST",
        headers,
        body: JSON.stringify({ page_id: owner.pageId, token_hash: "a".repeat(64) }),
      }),
    );
    await denied(
      await fetch(rest, {
        method: "POST",
        headers,
        body: JSON.stringify({
          page_id: owner.pageId,
          token_hash: "b".repeat(64),
          expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        }),
      }),
    );
    await denied(
      await fetch(`${rest}?id=eq.${link.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ revoked_at: null }),
      }),
    );
    await denied(await fetch(`${rest}?id=eq.${link.id}`, { method: "DELETE", headers }));
    // The anonymous role has nothing either.
    await denied(await fetch(`${rest}?select=*`, { headers: { apikey: publishableKey() } }));

    const rows = await linkRows(owner.pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked_at).not.toBeNull();
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

test.describe("M6-10 the shared page in a browser", () => {
  test("M6-10 renders the draft with the status bar, no horizontal scroll, 44px targets, and no tracking or way out", async ({
    browser,
    context,
  }, info) => {
    const owner = await ownerWithDraftOnly(context);
    const link = await makeLink(owner.userId, owner.pageId);
    const visitor = await browser.newContext({
      ...(info.project.use as object),
      extraHTTPHeaders: { "x-forwarded-for": randomIp() },
    });
    const page = await visitor.newPage();
    const posts: string[] = [];
    const redirects: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/e"))
        posts.push(request.url());
      if (request.url().includes("/r/")) redirects.push(request.url());
    });

    const response = await page.goto(link.url);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Preview of ${owner.handle}`);
    const bar = page.getByRole("status").first();
    await expect(bar).toContainText("Draft preview. Not published yet.");
    await expect(bar).toContainText("This link expires");
    await expect(page.getByText(DRAFT_ONLY)).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "footer");

    if (info.project.name === "phone") {
      const box = (await page.locator("[data-page-root]").boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(388);
    } else {
      const viewport = page.viewportSize()!;
      const barBox = (await page.locator("[data-share-bar]").boundingBox())!;
      expect(barBox.x).toBe(0);
      expect(Math.round(barBox.width)).toBe(viewport.width);
      const column = (await page.locator(".pg-column").boundingBox())!;
      expect(column.width).toBeLessThanOrEqual(480);
      const centre = column.x + column.width / 2;
      expect(Math.abs(centre - viewport.width / 2)).toBeLessThan(2);
      // The background covers the viewport.
      const root = (await page.locator("[data-page-root]").boundingBox())!;
      expect(root.x).toBe(0);
      expect(Math.round(root.width)).toBe(viewport.width);
      expect(root.height).toBeGreaterThanOrEqual(viewport.height - 1);
    }

    // No way out: tapping a link, card or icon leaves the URL alone and requests no /r/ redirect.
    const start = page.url();
    const anchors = page.locator("[data-page-root] main a");
    const total = await anchors.count();
    expect(total).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(total, 6); i++) {
      await anchors.nth(i).click({ force: true });
      expect(page.url()).toBe(start);
    }
    // Embeds stay inert: no frame is ever mounted.
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
    expect(redirects).toEqual([]);
    await visitor.close();
  });
});
