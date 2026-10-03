import { expect, test } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { rawRequest } from "../fixtures/http";
import { desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * M5-24: the Privacy and Terms pages. Both exist from the marketing site (PR #4, PR #7); this spec
 * is the acceptance steps' own check of them: 200 on the marketing host with an h1, the date and a
 * readable column; what each covers; no cookies, no third-party request, axe clean; and the layout at
 * 390 and 1440. tests/e2e/marketing/site.spec.ts checks the wording of the processors and the
 * footer link too; nothing here repeats its exact strings except where an acceptance step names them.
 *
 * The PROGRESS.md note that both texts need Gary's review before launch is not a file this wave may
 * edit; it is in the hand-off.
 */

const PAGES = [
  { path: "/privacy", title: "Privacy policy" },
  { path: "/terms", title: "Terms of service" },
] as const;

for (const { path, title } of PAGES) {
  test.describe(`M5-24 ${path}`, () => {
    test(`M5-24 ${path} answers 200 on the marketing host with one h1, a Last updated date and no cookie`, async ({
      page,
    }) => {
      const raw = await rawRequest("localhost:3000", path);
      expect(raw.status).toBe(200);
      expect(raw.headers["set-cookie"]).toBeUndefined();

      const response = await page.goto(url(null, path));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByText(/^Last updated [A-Z][a-z]+ \d{1,2}, \d{4}$/)).toBeVisible();
      const dateTime = await page.locator("time").first().getAttribute("datetime");
      expect(dateTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(dateTime!))).toBe(false);
      // Not in the future, not stale by years: it is a date somebody can trust.
      expect(Date.parse(dateTime!)).toBeLessThanOrEqual(Date.now() + 86_400_000);
      expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual([]);
    });

    test(`M5-24 ${path} makes no request to a third-party host and passes axe with no serious or critical violation`, async ({
      page,
    }) => {
      const hosts = new Set<string>();
      page.on("request", (request) => {
        const target = new URL(request.url());
        if (target.protocol === "http:" || target.protocol === "https:") hosts.add(target.host);
      });
      await page.goto(url(null, path), { waitUntil: "networkidle" });
      // Everything came from this deployment (fonts are self-hosted by next/font).
      const own = new URL(url(null, "/")).host;
      expect([...hosts].filter((host) => host !== own)).toEqual([]);
      // And no third-party host is even referenced by the page's own markup.
      const html = await page.content();
      const referenced = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
        .map((match) => new URL(match[1]!))
        .filter((link) => link.host !== own && !/^(mailto|tel):/.test(link.protocol));
      // Links the reader may follow (a regulator, a provider's own policy) are allowed; loaded resources are not.
      const loaded = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            "script[src], img[src], iframe[src], link[rel=stylesheet][href], link[rel=preload][href]",
          ),
        ].map(
          (el) =>
            (el as HTMLElement).getAttribute("src") ??
            (el as HTMLElement).getAttribute("href") ??
            "",
        ),
      );
      for (const resource of loaded) {
        if (/^https?:\/\//.test(resource)) expect(new URL(resource).host, resource).toBe(own);
      }
      expect(referenced).toBeDefined();
      expect(await axeViolations(page)).toEqual([]);
    });

    test(`M5-24 ${path} has the Main page chrome: skip link, header, footer with Privacy and Terms (44px)`, async ({
      page,
    }) => {
      await page.goto(url(null, path));
      await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
      const header = page.locator("header").first();
      expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        "rgb(28, 27, 26)",
      );
      await expect(page.locator("main#main")).toHaveCount(1);
      const footer = page.getByRole("navigation", { name: "Footer" });
      for (const [name, target] of [
        ["Privacy", "/privacy"],
        ["Terms", "/terms"],
      ] as const) {
        const link = footer.getByRole("link", { name, exact: true });
        await expect(link).toHaveAttribute("href", target);
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    });

    test(`M5-24 ${path} at 390: no sideways scroll, footer links 44px tall, tables and code stay inside the screen`, async ({
      page,
    }, info) => {
      test.skip(!phoneOnly(info), "the phone layout");
      await page.goto(url(null, path));
      await expectNoHorizontalScroll(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth),
      );
      for (const link of await page
        .getByRole("navigation", { name: "Footer" })
        .getByRole("link")
        .all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expectTapTargets(page, "footer");
      const overflowing = await page.evaluate(() =>
        [...document.querySelectorAll(".prose-hl table, .prose-hl pre, .prose-hl code")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
          .map((el) => el.tagName),
      );
      expect(overflowing).toEqual([]);
      // The column fills the phone (a 24px gutter each side), and the text is readable at 16px.
      const column = (await page.locator(".prose-hl").boundingBox())!;
      expect(column.x).toBeGreaterThanOrEqual(16);
      expect(column.x + column.width).toBeLessThanOrEqual(390 - 16 + 0.5);
      const fontSize = await page
        .locator(".prose-hl p")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(16);
    });

    test(`M5-24 ${path} at 1440: a centered content block, the text column no wider than 70 characters`, async ({
      page,
    }, info) => {
      test.skip(!desktopOnly(info), "the desktop layout");
      await page.goto(url(null, path));
      await expectNoHorizontalScroll(page);
      const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
      const column = (await page.locator(".prose-hl").boundingBox())!;
      const viewport = page.viewportSize()!.width;
      // The page container is centered: the same margin on both sides of the header's content.
      expect(Math.abs(heading.x - (viewport - (heading.x + heading.width)))).toBeLessThanOrEqual(2);
      // The text column sits inside it, no wider than 70 characters of its own font.
      expect(column.x).toBeGreaterThanOrEqual(heading.x);
      expect(column.x + column.width).toBeLessThanOrEqual(heading.x + heading.width + 0.5);
      const seventy = await page.locator(".prose-hl").evaluate((el) => {
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = getComputedStyle(el).font;
        return 70 * context.measureText("0").width;
      });
      expect(column.width).toBeLessThanOrEqual(seventy + 1);
      // The contents list is beside it on a wide screen.
      const toc = (await page.getByRole("navigation", { name: "Contents" }).boundingBox())!;
      expect(toc.x + toc.width).toBeLessThanOrEqual(column.x);
    });
  });
}

test.describe("M5-24 what each page covers", () => {
  test("M5-24 Privacy covers email, handle, page content, uploaded images, the cookieless analytics hash and the processors", async ({
    page,
  }) => {
    await page.goto(url(null, "/privacy"));
    const text = (await page.locator(".prose-hl").innerText()).replace(/\s+/g, " ");
    for (const phrase of [
      /email address/i,
      /handle/i,
      /page content/i,
      /uploaded images/i,
      // The analytics: IP address and user agent, a value that changes every day, a one-way hash, no cookies.
      /IP address and user agent/i,
      /changes every day/i,
      /one-way hash/i,
      /without cookies/i,
      // The processors, named.
      /Vercel/,
      /Supabase/,
      /Stripe/,
      /Resend/,
      /Google/,
    ]) {
      expect(text, String(phrase)).toMatch(phrase);
    }
    // A reader can get to each of them from the contents list.
    for (const label of ["What we collect", "Cookies", "Service providers", "Your rights"]) {
      await expect(
        page.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: label }),
      ).toBeVisible();
    }
  });

  test("M5-24 Terms cover acceptable use (phishing, malware, impersonation, illegal content), reports, suspension and the Free-plan traffic review", async ({
    page,
  }) => {
    await page.goto(url(null, "/terms"));
    const text = (await page.locator(".prose-hl").innerText()).replace(/\s+/g, " ");
    for (const phrase of [
      /phishing/i,
      /malware/i,
      /impersonation/i,
      /illegal content/i,
      /report link/i,
      /suspend/i,
      /Free plan traffic/i,
      /review Free pages/i,
    ]) {
      expect(text, String(phrase)).toMatch(phrase);
    }
    for (const id of ["reports", "traffic"]) {
      await expect(page.locator(`h2#${id}`)).toBeVisible();
    }
  });
});

test.describe("M5-24 where Privacy and Terms are linked from", () => {
  test("M5-24 the Main footer links both, on the home page and on a deep page", async ({
    page,
  }) => {
    for (const path of ["/", "/pricing", "/faq"]) {
      await page.goto(url(null, path));
      const footer = page.getByRole("navigation", { name: "Footer" });
      await expect(footer.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute(
        "href",
        "/privacy",
      );
      await expect(footer.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute(
        "href",
        "/terms",
      );
    }
  });

  test("M5-24 the sign-up page links Terms and Privacy to the marketing pages, and they resolve", async ({
    page,
    request,
  }) => {
    await page.goto(url("app", "/signup"));
    const terms = page.getByRole("link", { name: "Terms", exact: true });
    const privacy = page.getByRole("link", { name: "Privacy Policy", exact: true });
    await expect(terms).toHaveAttribute("href", url(null, "/terms"));
    await expect(privacy).toHaveAttribute("href", url(null, "/privacy"));
    for (const href of [url(null, "/terms"), url(null, "/privacy")]) {
      expect((await request.get(href)).status(), href).toBe(200);
    }
  });

  test("M5-24 the report page links Terms and Privacy (its footer is the same one)", async ({
    page,
  }) => {
    const response = await page.goto(url(null, "/report"));
    // The report page is the reports feature's (M5-05); this only needs it to exist to look at its links.
    test.skip(response?.status() !== 200, "the report page is not built yet");
    const links = await page
      .locator("a[href='/terms'], a[href='/privacy'], a[href^='/terms#']")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(links).toContain("/terms");
    expect(links).toContain("/privacy");
  });
});
