import { expect, test, type Page } from "@playwright/test";
import { emptyDraft, toPublishForm, type Block, type PublishDoc } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import {
  accessTokenFor,
  cleanupUsers,
  desktopOnly,
  makeUser,
  rand,
  signedInUser,
} from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { pngSizeOf, rawBuffer, tenantGet } from "./publish-helpers";

/**
 * M2-22, M2-28, M2-29 and M2-30: the public page renders published content only, with safe
 * headers, the Free badge, the report link and the OG image. Runs against the dev server, which
 * renders every request; the caching checks (x-nextjs-cache, tags) are in publish-cache.spec.ts.
 */

test.afterAll(cleanupUsers);

type Plan = "free" | "pro" | "studio";

interface Fixture {
  userId: string;
  pageId: string;
  handle: string;
}

const link = (id: string, label: string, href = "https://example.com/x"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url: href,
});

/** A user with a page that is published (`published` doc written with the secret key). */
async function publishedPage(
  label: string,
  opts: {
    plan?: Plan;
    name?: string;
    bio?: string;
    blocks?: Block[];
    tokens?: Partial<TokenSet>;
    publish?: boolean;
    extraPublished?: Record<string, unknown>;
  } = {},
): Promise<Fixture & { doc: PublishDoc }> {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  const draft = emptyDraft(handle);
  draft.profile.name = opts.name ?? "Zq Public";
  draft.profile.bio = opts.bio ?? "A short bio for the public page.";
  draft.blocks = opts.blocks ?? [
    link("lnk-public-01", "First link"),
    link("lnk-public-02", "Second link"),
  ];
  const doc = toPublishForm(draft, opts.tokens ?? null);
  const row: Record<string, unknown> = { owner_id: user.id, handle, draft };
  if (opts.publish !== false) {
    row.published = { ...doc, ...opts.extraPublished };
    row.published_at = new Date().toISOString();
  }
  const { data, error } = await adminClient().from("pages").insert(row).select("id").single();
  if (error) throw new Error(`page insert failed: ${error.message}`);
  return { userId: user.id, pageId: data.id as string, handle, doc };
}

const maraPageId = async (): Promise<string> => {
  const { data } = await adminClient().from("pages").select("id").eq("handle", "mara").single();
  return data!.id as string;
};

const metaContent = (html: string, attr: "name" | "property", key: string): string | null => {
  const tag = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*>`, "i").exec(html)?.[0];
  return tag ? (/content="([^"]*)"/i.exec(tag)?.[1] ?? null) : null;
};
const decode = (value: string | null) =>
  value
    ?.replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'") ?? null;

// ---------------------------------------------------------------------------------------------
// M2-22
// ---------------------------------------------------------------------------------------------

test.describe("M2-22 public page", () => {
  test("M2-22 mara: 200, title, description, lang, rendered by PageRenderer with its frozen tokens", async ({
    page,
  }) => {
    const res = await tenantGet("mara");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="en"');
    expect(res.text).toContain("<title>Mara Okafor - links</title>");
    expect(decode(metaContent(res.text, "name", "description"))).toBe(
      "Portrait & studio photographer · Orlando, FL",
    );

    await page.goto(url("mara"));
    await expect(page).toHaveTitle("Mara Okafor - links");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const root = page.locator("[data-page-root]");
    await expect(root).toHaveCount(1);
    await expect(root.getByRole("heading", { level: 1 })).toHaveText("Mara Okafor");
    await expect(page.locator('[data-block-id="Bt5rJ1fGz6Os"]')).toContainText("Portrait sessions");
    // The frozen Noir tokens ride on the root as --t-* variables.
    const vars = await root.evaluate((el) => ({
      bg: getComputedStyle(el).getPropertyValue("--t-bg").trim(),
      accent: getComputedStyle(el).getPropertyValue("--t-accent").trim(),
      container: getComputedStyle(el).containerType,
    }));
    expect(vars).toEqual({ bg: "#16120E", accent: "#C9A86A", container: "inline-size" });
    // The hidden image block of the draft is not in the published page.
    await expect(page.locator('[data-block-id="Im4gB6kWs8Xz"]')).toHaveCount(0);
  });

  test("M2-22 draft isolation: a draft name and block never reach the page, its RSC payload or a draft key", async () => {
    const fx = await publishedPage("iso", { name: "Zq Published Name" });
    const draft = emptyDraft(fx.handle);
    draft.profile.name = "DRAFT-ONLY-7f3a";
    draft.blocks = [link("lnk-draft-001", "DRAFT-BLOCK-7f3a")];
    const { error } = await adminClient().from("pages").update({ draft }).eq("id", fx.pageId);
    expect(error).toBeNull();

    for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
      let res = await tenantGet(fx.handle, "/", headers);
      // Next.js redirects a bare RSC request to the same URL with its cache-busting `_rsc` query.
      if (res.status === 307)
        res = await tenantGet(fx.handle, String(res.headers.location), headers);
      expect(res.status, JSON.stringify(headers)).toBe(200);
      expect(res.text).toContain("Zq Published Name");
      expect(res.text).not.toContain("DRAFT-ONLY-7f3a");
      expect(res.text).not.toContain("DRAFT-BLOCK-7f3a");
      expect(res.text).not.toMatch(/"draft"\s*:/);
      expect(res.text).not.toMatch(/\\"draft\\"\s*:/);
    }
  });

  test("M2-22 direct-API abuse: the publishable key cannot read published or draft, signed in or not", async ({
    browser,
  }) => {
    const fx = await publishedPage("abuse");
    const rest = (token?: string) =>
      fetch(`${supabaseUrl()}/rest/v1/pages?select=published,draft&handle=eq.${fx.handle}`, {
        headers: {
          apikey: publishableKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

    // Anonymous: the role has no privilege on pages at all, so there is nothing to read.
    const anon = await rest();
    const anonBody = await anon.text();
    expect(anonBody).not.toContain("Zq Public");
    expect(anonBody).not.toContain("published_at");
    expect([200, 401, 403]).toContain(anon.status);
    if (anon.status === 200) expect(JSON.parse(anonBody)).toEqual([]);

    // Signed in as another user (jonas): RLS lets him read his own pages only, so `[]`.
    const context = await browser.newContext();
    const jonas = await signedInUser(context, { label: "jonas" });
    const token = await accessTokenFor(jonas.email);
    const other = await rest(token);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual([]);
    await context.close();
  });

  test("M2-22 a handle with published null shows the placeholder, never draft content; an unknown handle is 404", async ({
    page,
  }) => {
    const fx = await publishedPage("unpub", { publish: false, name: "DRAFT-NEVER-SHOWN" });
    const res = await tenantGet(fx.handle);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Nothing published here yet.");
    expect(res.text).not.toContain("DRAFT-NEVER-SHOWN");
    expect(res.text).not.toContain("data-page-root");

    const unknown = await tenantGet(`nobody-${rand(6)}`);
    expect(unknown.status).toBe(404);
    const response = await page.goto(url(`nobody-${rand(6)}`));
    expect(response?.status()).toBe(404);
  });

  test("M2-22 host-only cookies: tenant hosts see no sb- cookie and set none", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signedInUser(context, { label: "ck" });
    const cookies = await context.cookies("http://mara.localhost:3000");
    expect(cookies.filter((c) => c.name.startsWith("sb-"))).toEqual([]);
    expect(
      (await context.cookies("http://app.localhost:3000")).some((c) => c.name.startsWith("sb-")),
    ).toBe(true);

    const page = await context.newPage();
    const response = await page.goto(url("mara"));
    expect(response?.status()).toBe(200);
    expect(await response?.headerValue("set-cookie")).toBeNull();
    expect(
      (await context.cookies("http://mara.localhost:3000")).filter((c) => c.name.startsWith("sb-")),
    ).toEqual([]);

    const raw = await tenantGet("mara");
    expect(raw.headers["set-cookie"]).toBeUndefined();
    await context.close();
  });

  test("M2-22 response headers: CSP without a script nonce, nosniff, referrer policy", async () => {
    const res = await tenantGet("mara");
    expect(res.headers["content-security-policy"]).toBe(
      "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(res.headers["content-security-policy"]).not.toMatch(/nonce|script-src/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    // The same headers on a 404, the OG image and a sub-path.
    for (const [path, host] of [
      ["/og", "mara"],
      ["/anything", "mara"],
      ["/", `nobody-${rand(5)}`],
    ] as const) {
      const other = await tenantGet(host, path);
      expect(other.headers["content-security-policy"], `${host}${path}`).toContain(
        "frame-ancestors 'none'",
      );
      expect(other.headers["x-content-type-options"], `${host}${path}`).toBe("nosniff");
    }
  });

  test("M2-22 YouTube and Spotify embeds load without a CSP violation; any other frame is blocked", async ({
    page,
  }) => {
    const fx = await publishedPage("emb", {
      blocks: [
        {
          id: "emb-youtube-1",
          type: "embed",
          visible: true,
          url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
          caption: "Behind the lens",
        },
        {
          id: "emb-spotify-1",
          type: "embed",
          visible: true,
          url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
          caption: "A track",
        },
      ],
    });
    const violations: string[] = [];
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) consoleErrors.push(message.text());
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as unknown as { __csp: string[] }).__csp ??= [];
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await page.goto(url(fx.handle));

    // YouTube mounts its iframe on a click; Spotify is an iframe from the start.
    await page.getByRole("button", { name: /Play video/ }).click();
    const frames = page.locator("iframe");
    await expect(frames).toHaveCount(2);
    const sources = await frames.evaluateAll((els) =>
      els.map((el) => (el as HTMLIFrameElement).src),
    );
    expect(sources.some((s) => s.startsWith("https://www.youtube-nocookie.com/embed/"))).toBe(true);
    expect(sources.some((s) => s.startsWith("https://open.spotify.com/embed/"))).toBe(true);
    await page.waitForTimeout(500);
    violations.push(
      ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
    );
    expect(violations).toEqual([]);
    expect(consoleErrors).toEqual([]);

    // An injected iframe to another origin is blocked by frame-src.
    const blocked = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            "securitypolicyviolation",
            (event) => resolve(event.violatedDirective),
            {
              once: true,
            },
          );
          const frame = document.createElement("iframe");
          frame.src = "https://evil.example/";
          document.body.appendChild(frame);
          setTimeout(() => resolve("not blocked"), 4000);
        }),
    );
    expect(blocked).toMatch(/^frame-src/);
  });

  test("M2-22 phone: no sideways scroll and every anchor, button and social icon is at least 44px", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "390px layout");
    await page.goto(url("mara"));
    await expect(page.locator("[data-page-root]")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-page-root]");
    const small = await page
      .locator("[data-page-root] a, [data-page-root] button")
      .evaluateAll((els) =>
        els
          .map((el) => ({
            label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30),
            h: el.getBoundingClientRect().height,
          }))
          .filter((item) => item.h > 0 && item.h < 44),
      );
    expect(small).toEqual([]);
  });

  test("M2-22 desktop: the column is at most 480px wide, centered, and the background covers the viewport", async ({
    page,
    isMobile,
  }, info) => {
    test.skip(!desktopOnly(info) || isMobile, "1440px layout");
    await page.goto(url("mara"));
    const column = (await page.locator("[data-page-root] .pg-column").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(column.width).toBeLessThanOrEqual(480);
    expect(Math.abs(column.x + column.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    const root = (await page.locator("[data-page-root]").boundingBox())!;
    expect(root.width).toBeGreaterThanOrEqual(viewport.width);
    expect(root.height).toBeGreaterThanOrEqual(viewport.height);
    const bg = await page
      .locator("[data-page-root]")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(22, 18, 14)");
    await expectNoHorizontalScroll(page);
  });
});

// ---------------------------------------------------------------------------------------------
// M2-28 badge
// ---------------------------------------------------------------------------------------------

const badge = (page: Page) => page.getByRole("link", { name: "Made with HYDLNK" });
const report = (page: Page) => page.getByRole("link", { name: "Report this page" });

test.describe("M2-28 Made with HYDLNK", () => {
  test("M2-28 free shows the badge (marketing origin, rel=noopener), pro and studio do not", async ({
    page,
  }) => {
    const free = await publishedPage("bfree", { plan: "free" });
    await page.goto(url(free.handle));
    await expect(badge(page)).toHaveCount(1);
    await expect(badge(page)).toHaveAttribute("href", "http://localhost:3000");
    await expect(badge(page)).toHaveAttribute("rel", "noopener");
    // Inside the renderer's footer slot, not a block.
    await expect(page.locator("[data-page-footer] a", { hasText: "Made with HYDLNK" })).toHaveCount(
      1,
    );

    for (const plan of ["pro", "studio"] as const) {
      const paid = await publishedPage(`b${plan}`, { plan });
      await page.goto(url(paid.handle));
      await expect(page.locator("[data-page-root]")).toBeVisible();
      await expect(badge(page), plan).toHaveCount(0);
      // The report link stays.
      await expect(report(page), plan).toHaveCount(1);
    }
  });

  test("M2-28 the badge follows the account's plan at render time, with no republish", async ({
    page,
  }) => {
    const fx = await publishedPage("bplan", { plan: "free" });
    await page.goto(url(fx.handle));
    await expect(badge(page)).toHaveCount(1);
    const before = (
      await adminClient()
        .from("pages")
        .select("published, published_at")
        .eq("id", fx.pageId)
        .single()
    ).data;

    const up = await adminClient().from("accounts").update({ plan: "pro" }).eq("id", fx.userId);
    expect(up.error).toBeNull();
    await page.goto(url(fx.handle));
    await expect(badge(page)).toHaveCount(0);

    await adminClient().from("accounts").update({ plan: "free" }).eq("id", fx.userId);
    await page.goto(url(fx.handle));
    await expect(badge(page)).toHaveCount(1);
    const after = (
      await adminClient()
        .from("pages")
        .select("published, published_at")
        .eq("id", fx.pageId)
        .single()
    ).data;
    expect(after).toEqual(before);
  });

  test("M2-28 direct-API abuse: draft keys cannot hide the badge and a client cannot set its plan", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const user = await signedInUser(context, { label: "babuse", plan: "free" });
    const token = await accessTokenFor(user.email);
    const patch = (path: string, body: unknown) =>
      fetch(`${supabaseUrl()}/rest/v1${path}`, {
        method: "PATCH",
        headers: {
          apikey: publishableKey(),
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });

    const plan = await patch(`/accounts?id=eq.${user.userId}`, { plan: "pro" });
    expect(plan.status).toBeGreaterThanOrEqual(400);
    const row = await adminClient().from("accounts").select("plan").eq("id", user.userId).single();
    expect(row.data?.plan).toBe("free");

    // The draft is client-writable, so these keys land in `draft`; they are not part of the
    // document, never reach `published`, and never decide the badge.
    const current = (
      await adminClient().from("pages").select("draft").eq("id", user.pageId).single()
    ).data!.draft as Record<string, unknown>;
    const hostile = {
      ...current,
      badge: false,
      settings: { hideBadge: true, hideReport: true },
      profile: { ...(current.profile as object), badge: false },
    };
    const write = await patch(`/pages?id=eq.${user.pageId}`, { draft: hostile });
    expect(write.status).toBe(200);
    // Publish through the product (the real gate strips unknown keys), then check what it wrote.
    const editor = await context.newPage();
    await editor.goto(url("app", "/editor"));
    await expect(editor.getByLabel("Display name", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: /^Publish/ }).click();
    await expect(editor.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "published",
      { timeout: 30_000 },
    );
    const stored = await adminClient()
      .from("pages")
      .select("published")
      .eq("id", user.pageId)
      .single();
    expect(stored.data?.published).not.toBeNull();
    expect(JSON.stringify(stored.data?.published)).not.toMatch(/hideBadge|hideReport|"badge"/);
    const page = await context.newPage();
    await page.goto(url(user.handle));
    await expect(badge(page)).toHaveCount(1);
    await expect(report(page)).toHaveCount(1);
    await context.close();
  });

  test("M2-28 the badge keeps AA contrast (4.5:1) in the Noir, Ivory and Smoke system themes", async ({
    page,
  }) => {
    const themes = await adminClient().from("themes").select("name, tokens").is("owner_id", null);
    expect(themes.error).toBeNull();
    const byName = new Map(
      (themes.data ?? []).map((t) => [t.name as string, t.tokens as Partial<TokenSet>]),
    );
    for (const name of ["Noir", "Ivory", "Smoke"]) {
      expect(byName.has(name), name).toBe(true);
      const fx = await publishedPage(`bc${name.toLowerCase()}`, {
        plan: "free",
        tokens: byName.get(name),
      });
      await page.goto(url(fx.handle));
      const result = await page.evaluate(() => {
        const link = [...document.querySelectorAll("[data-page-footer] a")].find(
          (a) => a.textContent === "Made with HYDLNK",
        ) as HTMLElement;
        const root = document.querySelector("[data-page-root]") as HTMLElement;
        const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
        };
        const fg = getComputedStyle(link).color;
        const bg = getComputedStyle(root).backgroundColor;
        const [a, b] = [lum(parse(fg)), lum(parse(bg))];
        return { fg, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
      expect(result.ratio, `${name}: ${result.fg} on ${result.bg}`).toBeGreaterThanOrEqual(4.5);
      // It is --t-text-muted on --t-bg.
      const expected = await page.evaluate(() => {
        const root = document.querySelector("[data-page-root]") as HTMLElement;
        const probe = document.createElement("span");
        probe.style.color = "var(--t-text-muted)";
        root.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      expect(result.fg).toBe(expected);
    }
  });

  test("M2-28 layout: the badge is a 44px tap target after the last block, clear of the report link", async ({
    page,
    isMobile,
  }, info) => {
    const fx = await publishedPage("blay", { plan: "free" });
    await page.goto(url(fx.handle));
    const b = (await badge(page).boundingBox())!;
    const r = (await report(page).boundingBox())!;
    const lastBlock = (await page.locator("[data-block-id]").last().boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(b.y).toBeGreaterThanOrEqual(lastBlock.y + lastBlock.height - 1);
    const overlap = !(
      b.x + b.width <= r.x ||
      r.x + r.width <= b.x ||
      b.y + b.height <= r.y ||
      r.y + r.height <= b.y
    );
    expect(overlap).toBe(false);
    await expectNoHorizontalScroll(page);
    if (isMobile) await expectTapTargets(page, "[data-page-footer]");
    if (desktopOnly(info)) {
      const column = (await page.locator("[data-page-root] .pg-column").boundingBox())!;
      const footer = (await page.locator("[data-page-footer]").boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(
        Math.abs(footer.x + footer.width / 2 - (column.x + column.width / 2)),
      ).toBeLessThanOrEqual(2);
      expect(Math.abs(footer.x + footer.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
      expect(footer.width).toBeLessThanOrEqual(column.width + 1);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// M2-29 report link
// ---------------------------------------------------------------------------------------------

test.describe("M2-29 Report this page", () => {
  test("M2-29 is in the static HTML on every page: mara, zero blocks, pro without a badge", async () => {
    const maraId = await maraPageId();
    const cases: [string, string][] = [["mara", maraId]];
    const empty = await publishedPage("rzero", { blocks: [], plan: "free" });
    const pro = await publishedPage("rpro", { plan: "pro" });
    cases.push([empty.handle, empty.pageId], [pro.handle, pro.pageId]);

    for (const [handle, pageId] of cases) {
      const res = await tenantGet(handle); // curl: no JavaScript
      expect(res.status, handle).toBe(200);
      const hrefs = [...res.text.matchAll(/<a[^>]*href="([^"]*)"[^>]*>Report this page<\/a>/g)].map(
        (m) => m[1],
      );
      expect(hrefs, handle).toEqual([`http://localhost:3000/report?page=${pageId}`]);
    }
    const zero = await tenantGet(empty.handle);
    expect(zero.text).not.toContain("data-block-id");
  });

  test("M2-29 only the page id is in the href: a hostile handle, name or bio never reaches it", async ({
    page,
  }) => {
    const fx = await publishedPage("rhost", {
      name: '"><img src=x onerror=alert(1)> & report',
      bio: "javascript:alert(1)",
    });
    await page.goto(url(fx.handle));
    const href = (await report(page).getAttribute("href"))!;
    expect(href).toBe(`http://localhost:3000/report?page=${fx.pageId}`);
    expect(href).not.toContain(fx.handle);
    expect(await report(page).textContent()).toBe("Report this page");
  });

  test("M2-29 direct-API abuse: a published key cannot remove it", async () => {
    const fx = await publishedPage("rabuse", {
      plan: "pro",
      extraPublished: { settings: { hideReport: true, hideBadge: true }, hideReport: true },
    });
    const res = await tenantGet(fx.handle);
    expect(res.text).toContain(">Report this page</a>");
    expect(res.text).not.toContain("hideReport");
  });

  test("M2-29 layout: a 44px tap area clear of the badge, no sideways scroll, centered under the column", async ({
    page,
    isMobile,
  }, info) => {
    const fx = await publishedPage("rlay", { plan: "free" });
    await page.goto(url(fx.handle));
    const r = (await report(page).boundingBox())!;
    const b = (await badge(page).boundingBox())!;
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(r.width).toBeGreaterThanOrEqual(44);
    expect(
      !(
        b.x + b.width <= r.x ||
        r.x + r.width <= b.x ||
        b.y + b.height <= r.y ||
        r.y + r.height <= b.y
      ),
    ).toBe(false);
    await expectNoHorizontalScroll(page);
    if (isMobile) await expectTapTargets(page, "[data-page-footer]");
    if (desktopOnly(info)) {
      const viewport = page.viewportSize()!;
      const footer = (await page.locator("[data-page-footer]").boundingBox())!;
      expect(Math.abs(footer.x + footer.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// M2-30 OG image
// ---------------------------------------------------------------------------------------------

test.describe("M2-30 OG image and social metadata", () => {
  test("M2-30 the metadata names the page, with absolute URLs on the host it is served from", async () => {
    const res = await tenantGet("mara");
    const html = res.text;
    expect(decode(metaContent(html, "property", "og:title"))).toBe("Mara Okafor");
    expect(decode(metaContent(html, "property", "og:description"))).toBe(
      "Portrait & studio photographer · Orlando, FL",
    );
    expect(metaContent(html, "property", "og:type")).toBe("website");
    expect(metaContent(html, "property", "og:url")).toBe("http://mara.localhost:3000/");
    const image = decode(metaContent(html, "property", "og:image"))!;
    expect(image).toMatch(/^http:\/\/mara\.localhost:3000\/og(\?v=\d+)?$/);
    expect(metaContent(html, "name", "twitter:card")).toBe("summary_large_image");
    expect(decode(metaContent(html, "name", "twitter:image"))).toBe(image);
  });

  test("M2-30 the og:image is a 1200x630 PNG with a public cache-control", async () => {
    const meta = decode(metaContent((await tenantGet("mara")).text, "property", "og:image"))!;
    const target = new URL(meta);
    const res = await rawBuffer(target.host, `${target.pathname}${target.search}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(pngSizeOf(res.body)).toEqual({ width: 1200, height: 630 });
    expect(res.body.length).toBeGreaterThan(5_000);
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).toMatch(/s-maxage=\d+|max-age=\d+/);
    // The exact URL of the metadata is immutable; the bare /og is cached briefly. Neither may sit in a
    // CDN for more than five minutes (M5-08): nothing purges a CDN copy, and a suspended page's name,
    // bio and photo must not outlive its 404.
    expect(res.headers["cache-control"]).toMatch(/immutable/);
    const longest = (value: unknown) =>
      Math.max(
        ...[
          ...String(value).matchAll(
            /(?:s-)?maxage=(\d+)|max-age=(\d+)|stale-while-revalidate=(\d+)/g,
          ),
        ].map((m) => Number(m[1] ?? m[2] ?? m[3])),
      );
    expect(longest(res.headers["cache-control"])).toBeLessThanOrEqual(300);
    const bare = await tenantGet("mara", "/og");
    expect(longest(bare.headers["cache-control"])).toBeLessThanOrEqual(300);
    expect(bare.headers["cache-control"]).toMatch(/public/);
    expect(bare.body.equals(res.body)).toBe(true);
  });

  test("M2-30 a 60-character unbroken name and a 160-character bio still give a valid image", async () => {
    const fx = await publishedPage("ogbig", {
      name: "N".repeat(60),
      bio: "b".repeat(160),
    });
    const res = await tenantGet(fx.handle, "/og");
    expect(res.status).toBe(200);
    expect(pngSizeOf(res.body)).toEqual({ width: 1200, height: 630 });
    const emoji = await publishedPage("ogemo", { name: "Zq 📸 漢字", bio: "🎉 ✨ 漢字" });
    const second = await tenantGet(emoji.handle, "/og");
    expect(second.status).toBe(200);
    expect(pngSizeOf(second.body)).toEqual({ width: 1200, height: 630 });
  });

  test("M2-30 a page with published null has no og:image and its image route is 404", async () => {
    const fx = await publishedPage("ognull", { publish: false });
    const res = await tenantGet(fx.handle);
    expect(res.text).not.toMatch(/og:image/);
    expect(res.text).not.toMatch(/twitter:image/);
    const image = await tenantGet(fx.handle, "/og");
    expect(image.status).toBe(404);
    expect((await tenantGet(`nobody-${rand(6)}`, "/og")).status).toBe(404);
  });

  test("M2-30 editing the draft does not change the image; changing the published name does", async () => {
    const fx = await publishedPage("ogedit", { name: "Zq Original" });
    const before = (await tenantGet(fx.handle, "/og")).body;

    const draft = emptyDraft(fx.handle);
    draft.profile.name = "Zq Draft Edit";
    await adminClient().from("pages").update({ draft }).eq("id", fx.pageId);
    expect((await tenantGet(fx.handle, "/og")).body.equals(before)).toBe(true);

    // A Publish: the new published copy and published_at.
    const next: PublishDoc = {
      ...fx.doc,
      profile: { ...fx.doc.profile, name: "Zq After Publish" },
    };
    await adminClient()
      .from("pages")
      .update({ published: next, published_at: new Date().toISOString() })
      .eq("id", fx.pageId);
    const after = (await tenantGet(fx.handle, "/og")).body;
    expect(after.equals(before)).toBe(false);
    expect(pngSizeOf(after)).toEqual({ width: 1200, height: 630 });
  });

  test("M2-30 draws the page's frozen colors", async () => {
    const light = await publishedPage("ogl", {
      tokens: { ...SYSTEM_DEFAULT_TOKENS, bg: "#FFFFFF", text: "#111111", accent: "#CC0000" },
    });
    const dark = await publishedPage("ogd", {
      tokens: { ...SYSTEM_DEFAULT_TOKENS, bg: "#000000", text: "#EEEEEE", accent: "#00CC00" },
    });
    const [a, b] = [await tenantGet(light.handle, "/og"), await tenantGet(dark.handle, "/og")];
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.equals(b.body)).toBe(false);
  });
});
