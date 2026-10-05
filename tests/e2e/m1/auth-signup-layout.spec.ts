import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { routeGoogleScript, stubFace } from "../fixtures/google-stub";

const SIGNUP = url("app", "/signup");
const css = (page: Page, selector: string, prop: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe("M1-10 signup page layout with brand panel and form", () => {
  test("M1-10 title and form column copy", async ({ page, context }) => {
    await routeGoogleScript(context);
    const response = await page.goto(SIGNUP);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("HYDLNK \u2014 Sign up");
    await expect(page.getByRole("heading", { level: 1, name: "Create your site" })).toBeVisible();
    await expect(
      page.getByText(
        "Pick a handle and we\u2019ll email you a sign-in link. No password to remember.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Handle")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.getByText("or", { exact: true })).toBeVisible();
    // Google's own button (stubbed here, M1-30) follows the "or" rule.
    await expect(stubFace(page)).toBeVisible();
    await expect(page.getByText("By continuing you agree to the")).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      url(null, "/terms"),
    );
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      url(null, "/privacy"),
    );
    await expect(page.getByText("Already have a site?")).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("M1-10 fonts, 16px inputs, 48px primary button", async ({ page }) => {
    await page.goto(SIGNUP);
    expect(await css(page, "h1", "font-family")).toMatch(/public[_ ]sans/i);
    const handle = page.getByLabel("Handle");
    expect(await handle.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
      /geist[_ ]mono/i,
    );
    // The handle field (input plus suffix, inside its border) is 48px tall; the suffix is #7A766F.
    const field = handle.locator("xpath=..");
    expect((await field.boundingBox())!.height).toBe(48);
    expect(await field.getByText(".hydlnk.com").evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(122, 118, 111)",
    );
    for (const input of await page.locator("input:visible").all()) {
      expect(
        await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    }
    const primary = await page
      .getByRole("button", { name: "Email me a sign-in link" })
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { h: el.getBoundingClientRect().height, bg: s.backgroundColor, color: s.color };
      });
    expect(primary).toEqual({ h: 48, bg: "rgb(28, 27, 26)", color: "rgb(255, 255, 255)" });
  });

  test("M1-10 tab order and a 2px brass focus outline with 2px offset", async ({
    page,
    context,
  }) => {
    await routeGoogleScript(context);
    await page.goto(SIGNUP);
    await page.getByRole("heading", { level: 1 }).waitFor();
    // Wait for Google's button to be drawn: until then a disabled placeholder holds its space, and
    // it is not focusable. With no handle yet it is covered by an aria-disabled "Continue with
    // Google" button (M1-30), which only exists once the placeholder is gone.
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return "none";
          const label =
            el.getAttribute("aria-label") || el.textContent?.trim() || el.id || el.tagName;
          return `${el.tagName.toLowerCase()}:${label}`;
        }),
      );
      if (i === 3) {
        // The primary button is focused here: check the ring.
        const ring = await page.evaluate(() => {
          const s = getComputedStyle(document.activeElement!);
          return {
            w: s.outlineWidth,
            style: s.outlineStyle,
            color: s.outlineColor,
            offset: s.outlineOffset,
          };
        });
        expect(ring).toEqual({
          w: "2px",
          style: "solid",
          color: "rgb(184, 145, 79)",
          offset: "2px",
        });
      }
    }
    expect(seen[0]).toMatch(/^a:/); // logo link
    expect(seen[1]).toBe("input:su-handle"); // handle
    expect(seen[2]).toBe("input:su-email"); // email
    expect(seen[3]).toBe("button:Email me a sign-in link");
    // With no handle yet Google's button is covered by an aria-disabled "Continue with Google"
    // button (M1-30), and that cover is the focus stop: the iframe under it is inert.
    expect(seen[4]).toBe("button:Continue with Google");
    expect(seen[5]).toBe("a:Terms");
    expect(seen[6]).toBe("a:Privacy Policy");
    expect(seen[7]).toBe("a:Log in");
  });

  test.describe("phone layout", () => {
    test.skip(({ isMobile }) => !isMobile, "phone project only");
    test("M1-10 at 390x844: no scroll, 44px targets, slim logo-only bar, form directly beneath with 20px padding", async ({
      page,
    }) => {
      await page.goto(SIGNUP);
      await expect(page.getByRole("heading", { level: 1, name: "Create your site" })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      const bar = await page.locator("aside").boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(80);
      expect(await css(page, "aside", "background-color")).toBe("rgb(28, 27, 26)");
      for (const text of [
        "Claim your name.",
        "Free forever. No card required.",
        "Every block, theme and design option",
      ]) {
        await expect(page.getByText(text)).toBeHidden();
      }
      await expect(page.locator("aside").getByText(".hydlnk.com")).toBeHidden();
      const main = await page.locator("main").boundingBox();
      expect(main!.y).toBeCloseTo(bar!.y + bar!.height, 0);
      const column = await page.locator("main > div").boundingBox();
      expect(column!.x).toBe(20);
      expect(column!.x + column!.width).toBe(390 - 20);
    });
  });

  test.describe("desktop layout", () => {
    test.skip(({ isMobile }) => isMobile, "desktop project only");

    test("M1-10 at 1440x900: charcoal brand panel with logo, headline, pill, bullets and note", async ({
      page,
    }) => {
      await page.goto(SIGNUP);
      const panel = page.locator("aside");
      const box = await panel.boundingBox();
      expect(box!.x).toBe(0);
      expect(box!.width).toBeGreaterThanOrEqual(480);
      expect(await css(page, "aside", "background-color")).toBe("rgb(28, 27, 26)");

      const logo = panel.getByRole("link", { name: "HYDLNK home" });
      await expect(logo).toHaveAttribute("href", url(null, "/"));
      const wordmark = await logo.getByText("HYDLNK", { exact: true }).evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: s.fontSize, weight: s.fontWeight, spacing: s.letterSpacing };
      });
      expect(wordmark).toEqual({ size: "15px", weight: "700", spacing: "2.1px" });
      const diamond = await logo.locator("span[aria-hidden]").evaluate((el) => {
        const s = getComputedStyle(el);
        return { w: s.width, h: s.height, bg: s.backgroundColor };
      });
      expect(diamond).toEqual({ w: "9px", h: "9px", bg: "rgb(184, 145, 79)" });

      const headline = panel.getByText("Claim your name.");
      await expect(headline).toBeVisible();
      expect(
        await headline.evaluate((el) => ({
          size: getComputedStyle(el).fontSize,
          weight: getComputedStyle(el).fontWeight,
        })),
      ).toEqual({ size: "44px", weight: "700" });

      const pill = panel.getByText("you", { exact: true });
      await expect(pill).toBeVisible();
      expect(await pill.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(217, 184, 119)");
      const suffix = panel.getByText(".hydlnk.com", { exact: true });
      expect(await suffix.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(169, 164, 155)");
      expect(await suffix.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
        /geist[_ ]mono/i,
      );
      await expect(panel.locator("svg").first()).toBeVisible(); // lock icon

      for (const text of [
        "Every block, theme and design option",
        "Per-link analytics from day one",
        "Bring your own domain whenever you\u2019re ready",
        "Free forever. No card required.",
      ]) {
        await expect(panel.getByText(text)).toBeVisible();
      }
    });

    test("M1-10 at 1440x900: form column on the right, content centered at max 400px", async ({
      page,
    }) => {
      await page.goto(SIGNUP);
      const panel = await page.locator("aside").boundingBox();
      const main = await page.locator("main").boundingBox();
      const column = await page.locator("main > div").boundingBox();
      expect(main!.x).toBeGreaterThanOrEqual(panel!.x + panel!.width - 1);
      expect(column!.width).toBeLessThanOrEqual(400);
      const center = column!.x + column!.width / 2;
      expect(Math.abs(center - (main!.x + main!.width / 2))).toBeLessThan(2);
    });
  });
});

test.describe("M1-10 brand pill follows the handle", () => {
  test.skip(({ isMobile }) => isMobile, "the pill is hidden on phones");
  test("M1-10 typing a handle updates the pill; ?handle= seeds it", async ({ page }) => {
    await page.goto(url("app", "/signup?handle=zq-seed"));
    await expect(page.locator("aside").getByText("zq-seed", { exact: true })).toBeVisible();
    await page.getByLabel("Handle").fill("Cool Name_9");
    await expect(page.locator("aside").getByText("coolname9", { exact: true })).toBeVisible();
    await page.getByLabel("Handle").fill("");
    await expect(page.locator("aside").getByText("you", { exact: true })).toBeVisible();
  });
});
