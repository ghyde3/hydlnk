import { expect, test, type Page, type Request } from "@playwright/test";
import { userClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { accessToken, openEditor, pageRow, seededUser } from "../m2/editor-helpers";
import { openDesign, publishButton } from "./design-helpers";

/**
 * M3-04 (the public page loads only its two chosen families) and M3-02 (token values reach CSS
 * only through the strict schema): the public page of the seeded demo tenant (read-only), and the
 * direct-API abuse cases, where a hostile string is written to a draft with the publishable key.
 */

test.afterAll(cleanupUsers);

const MARA = "http://mara.localhost:3000/";
const NOIR_FONTS = ["Instrument Serif", "Geist"];

const familyOf = (page: Page, selector: string): Promise<string> =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);

/** Records every request URL the page makes. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request: Request) => urls.push(request.url()));
  return urls;
}

test.describe("M3-04 tenant fonts", () => {
  test("M3-04 mara's page links exactly the two chosen families, with preconnect hints and no other font host", async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "same document at both widths; asserted once");
    const urls = recordRequests(page);
    await page.goto(MARA);
    await expect(page.locator(".pg-name")).toBeVisible();

    const sheets = await page
      .locator("link[rel='stylesheet'][href*='fonts.googleapis.com']")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
    expect(sheets).toHaveLength(1);
    const sheet = new URL(sheets[0]!);
    expect(sheet.origin + sheet.pathname).toBe("https://fonts.googleapis.com/css2");
    expect(sheet.searchParams.getAll("family")).toEqual(NOIR_FONTS);
    expect(sheets[0]).toContain("family=Instrument+Serif&family=Geist");
    expect(sheet.searchParams.get("display")).toBe("swap");

    const hints = await page
      .locator("link[rel='preconnect']")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(hints).toEqual(
      expect.arrayContaining(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]),
    );

    // No other font host, in the markup or on the network, and no family that is not in use.
    const fontish = /font|typekit|bunny|adobe|cdnfonts/i;
    const hosts = new Set(urls.map((u) => new URL(u).hostname).filter((h) => fontish.test(h)));
    expect([...hosts].every((h) => h === "fonts.googleapis.com" || h === "fonts.gstatic.com")).toBe(
      true,
    );
    const allHrefs = await page
      .locator("link[href]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
    for (const href of allHrefs) {
      if (/^https?:/.test(href) && fontish.test(new URL(href).hostname)) {
        expect(["fonts.googleapis.com", "fonts.gstatic.com"]).toContain(new URL(href).hostname);
      }
    }
    expect(urls.filter((u) => /family=Fraunces/i.test(u))).toEqual([]);

    // Computed font families: heading serif, body sans, each with its generic fallback.
    expect(await familyOf(page, ".pg-name")).toMatch(/^"?Instrument Serif"?,.*\bserif$/);
    expect(await familyOf(page, ".pg-bio")).toMatch(/^"?Geist"?,.*\bsans-serif$/);
    await expectNoHorizontalScroll(page);
  });

  test("M3-04 phone and desktop: no horizontal scroll, the name and bio wrap, targets are 44px", async ({
    page,
  }) => {
    await page.goto(MARA);
    await expect(page.locator(".pg-name")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-page-root]");
    for (const selector of [".pg-name", ".pg-bio"]) {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  });

  test("M3-04 direct API: a hostile fontHeading in the draft never reaches a request, the preview or a stylesheet, and Publish refuses it", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dt1");
    const before = await pageRow(user.pageId);
    const client = userClient(await accessToken(context));
    const { data, error } = await client
      .from("pages")
      .update({
        draft: {
          ...before.draft,
          theme: { ...before.draft.theme, overrides: { fontHeading: "Evil;}" } },
        },
      })
      .eq("id", user.pageId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1); // RLS lets the owner write a draft

    const urls = recordRequests(page);
    for (const open of [() => openEditor(page), () => openDesign(page)]) {
      await open();
      const root = page.locator("[data-testid='preview-screen'] [data-page-root]");
      // The unreadable override is dropped: the preview draws the theme's own fonts.
      const name = await root.locator(".pg-name").evaluate((el) => getComputedStyle(el).fontFamily);
      expect(name).not.toMatch(/evil/i);
      expect(name).toMatch(/^"?Instrument Serif"?,.*\bserif$/);
      const links = await page
        .locator("link[href]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
      expect(links.filter((href) => /evil/i.test(decodeURIComponent(href)))).toEqual([]);
    }
    expect(urls.filter((u) => /evil/i.test(decodeURIComponent(u)))).toEqual([]);

    // Publish refuses the stored draft: the live page is untouched.
    await openEditor(page);
    await publishButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /fix your page/i })).toBeVisible();
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
  });
});

test.describe("M3-02 token variables", () => {
  test("M3-02 mara's root carries the published --t-* values and none of the app's --hl-* tokens", async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "same document at both widths; asserted once");
    await page.goto(MARA);
    const root = page.locator("[data-page-root]");
    await expect(root).toBeVisible();
    const vars = await root.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        bg: style.getPropertyValue("--t-bg").trim(),
        accent: style.getPropertyValue("--t-accent").trim(),
        text: style.getPropertyValue("--t-text").trim(),
        ink: style.getPropertyValue("--hl-ink").trim(),
        docInk: getComputedStyle(document.documentElement).getPropertyValue("--hl-ink").trim(),
      };
    });
    expect(vars.bg).toBe("#16120E");
    expect(vars.accent).toBe("#C9A86A");
    expect(vars.text).toBe("#EFE8DC");
    expect(vars.ink).toBe("");
    expect(vars.docInk).toBe("");
  });

  test("M3-02 direct API: a hostile bg in the draft overrides yields no script, no window.__x, and the default bg", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "dt2");
    const before = await pageRow(user.pageId);
    const client = userClient(await accessToken(context));
    const hostile = "red;}</style><script>window.__x=1</script>";
    const { data, error } = await client
      .from("pages")
      .update({
        draft: { ...before.draft, theme: { ...before.draft.theme, overrides: { bg: hostile } } },
      })
      .eq("id", user.pageId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    for (const target of [url("app", "/editor"), url("app", "/design")]) {
      await page.goto(target);
      await expect(page.locator("[data-testid='preview-screen'] [data-page-root]")).toHaveCount(1);
      const result = await page.evaluate(() => {
        const root = document.querySelector("[data-testid='preview-screen'] [data-page-root]")!;
        return {
          scripts: root.querySelectorAll("script").length,
          x: (window as unknown as { __x?: unknown }).__x,
          bg: getComputedStyle(root).getPropertyValue("--t-bg").trim(),
          html: root.outerHTML.includes("window.__x"),
        };
      });
      expect(result.scripts, target).toBe(0);
      expect(result.x, target).toBeUndefined();
      expect(result.html, target).toBe(false);
      expect(result.bg, target).toBe("#16120E"); // the applied theme's (Noir) resolved default
    }
  });
});
