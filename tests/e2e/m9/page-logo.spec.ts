import { expect, test, type Page } from "@playwright/test";
import { userClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { accessToken, expectDraft, pageRow, seededUser, statusChip } from "../m2/editor-helpers";
import { makePng } from "../m2/editor-images";
import { openEditor } from "../m2/blocks-helpers";
import { tenantGet } from "../m2/publish-helpers";
import { openDesign, previewRoot, saveStatus, showPreview, showTokens } from "../m3/design-helpers";
import { previewScreen, showView } from "../m2/blocks-helpers";
import { FONT_ALLOWLIST } from "@/lib/theme";
import { box, livePage, publishButton, publishFromEditor, uploadWide } from "./page-helpers";

/**
 * M9-24: the logo next to the name (or instead of it) and the name's own font and size, end to end:
 * the public page at both viewports, the Profile card's logo upload, the Design tab's Name font and
 * Name size, preview and live parity, and the direct-write abuse cases. Each test makes its own user.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const LONG_NAME = "Mara Okafor Photography Studio And Workshops In Orlando Fl";
const SIZE_FACTOR = { small: 0.85, medium: 1, large: 1.25, xlarge: 1.5 } as const;

const h1 = (page: Page) => page.locator("[data-page-root] h1");

/** An element's outerHTML with every style attribute rewritten as the browser's own CSSOM writes it, so markup compares by value. */
function normalizedOuterHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const node of [clone, ...clone.querySelectorAll("[style]")]) {
    if (node.hasAttribute("style")) node.setAttribute("style", (node as HTMLElement).style.cssText);
  }
  return clone.outerHTML;
}
const fontSize = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const familyOf = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((el) => getComputedStyle(el).fontFamily);

test.describe("M9-24 the logo and the name on the public page", () => {
  for (const placement of ["beside", "instead"] as const) {
    test(`M9-24 a wide logo ${placement} a 60-character extra-large name stays inside the column: the name wraps, the logo scales down, one h1 named the display name`, async ({
      page,
    }, info) => {
      expect(LONG_NAME.length).toBe(58);
      const live = await livePage(`lgp-${placement.slice(0, 2)}`, async (userId) => ({
        profile: {
          name: `${LONG_NAME}`.padEnd(60, "x"),
          logo: await uploadWide(userId, 900, 200),
          logoPlacement: placement,
          nameSize: "xlarge",
        },
      }));
      await page.goto(live.url);
      const root = page.locator("[data-page-root]");
      await expect(root).toBeVisible();
      const name = `${LONG_NAME}`.padEnd(60, "x");

      // Exactly one h1 whose accessible name is the display name, in either placement.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1, name })).toHaveCount(1);
      const logo = page.locator("img.pg-logo");
      await expect(logo).toHaveCount(1);
      if (placement === "instead") {
        expect(await logo.getAttribute("alt")).toBe(name);
        expect(await h1(page).innerText()).toBe("");
        expect(await logo.evaluate((el) => el.parentElement!.tagName)).toBe("H1");
      } else {
        expect(await logo.getAttribute("alt")).toBe("");
        expect(await h1(page).innerText()).toBe(name);
        expect(await logo.evaluate((el) => el.parentElement!.className)).toContain("pg-logo-row");
      }

      // Attributes: eager, async, no referrer, the stored size.
      expect(await logo.getAttribute("loading")).toBe("eager");
      expect(await logo.getAttribute("decoding")).toBe("async");
      expect(await logo.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect([await logo.getAttribute("width"), await logo.getAttribute("height")]).toEqual([
        "900",
        "200",
      ]);
      expect(await logo.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain");
      expect(await logo.evaluate((el) => getComputedStyle(el).maxWidth)).toBe("100%");

      // Inside the column, nothing sideways, and the logo's height follows the name's size (1.25em).
      const column = await box(page.locator(".pg-column"));
      const logoBox = await box(logo);
      expect(logoBox.x).toBeGreaterThanOrEqual(column.x - 0.5);
      expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
      const size = await fontSize(h1(page));
      expect(size).toBe(60); // 40px x 1.5 at the default text size
      expect(Math.abs(logoBox.height - 1.25 * size)).toBeLessThanOrEqual(1.5);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "[data-page-root] header");

      if (placement === "beside") {
        // The name wraps beside the logo instead of running past the column.
        const nameBox = await box(h1(page));
        expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
        expect(nameBox.height).toBeGreaterThan(size * 1.5);
      }
      if (desktopOnly(info)) {
        expect(column.width).toBeLessThanOrEqual(480.5);
      } else {
        expect(phoneOnly(info)).toBe(true);
      }
    });
  }

  test("M9-24 a hidden name with a logo shows the logo and keeps the page's one h1 for assistive technology; a page without the keys is the page it always was", async ({
    page,
  }) => {
    const hiddenName = await livePage("lgp3", async (userId) => ({
      profile: { logo: await uploadWide(userId), showName: false },
    }));
    await page.goto(hiddenName.url);
    await expect(page.locator("img.pg-logo")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Mara Okafor" })).toHaveCount(1);
    expect(await h1(page).evaluate((el) => el.hasAttribute("data-visually-hidden"))).toBe(true);

    const plain = await livePage("lgp4", () => ({}));
    await page.goto(plain.url);
    await expect(h1(page)).toHaveText("Mara Okafor");
    expect(await page.locator(".pg-name").first().getAttribute("class")).toBe("pg-name");
    const html = await page.content();
    for (const marker of [
      "pg-logo",
      "pg-name-s",
      "pg-name-l",
      "pg-name-xl",
      "pg-name-font",
      "--t-font-name",
    ]) {
      expect(html, marker).not.toContain(marker);
    }
  });

  test("M9-24 the name's size and font: the computed font-size is 0.85, 1, 1.25 or 1.5 times today's, the computed family is the chosen one, and only that family's file is added", async ({
    page,
  }) => {
    for (const [size, factor] of Object.entries(SIZE_FACTOR)) {
      const live = await livePage(`lgs-${size.slice(0, 2)}`, () => ({
        profile: size === "medium" ? {} : { nameSize: size },
      }));
      await page.goto(live.url);
      await expect(h1(page)).toBeVisible();
      expect(await fontSize(h1(page)), size).toBeCloseTo(40 * factor, 1);
    }

    // A third family at the heading weight: exactly one more font file, from the page's own host.
    const hosts = new Set<string>();
    const fontFiles = new Set<string>();
    page.on("request", (request) => {
      hosts.add(new URL(request.url()).host);
      if (request.resourceType() === "font") fontFiles.add(new URL(request.url()).pathname);
    });
    const base = await livePage("lgf1", () => ({}));
    await page.goto(base.url);
    await expect(h1(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    const baseline = fontFiles.size;
    fontFiles.clear();
    const third = await livePage("lgf2", () => ({ profile: { nameFont: "Fraunces" } }));
    await page.goto(third.url);
    await expect(h1(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await familyOf(h1(page))).toMatch(/^"?Fraunces"?/);
    expect(fontFiles.size).toBe(baseline + 1);
    expect([...fontFiles].some((file) => /fraunces-latin\./.test(file))).toBe(true);
    // The heading, the bio and the rest keep their fonts.
    expect(await familyOf(page.locator(".pg-bio"))).not.toMatch(/Fraunces/);
    expect([...hosts].every((host) => host.endsWith(".localhost:3000"))).toBe(true);

    // A name font equal to the heading font adds nothing.
    fontFiles.clear();
    const same = await livePage("lgf3", () => ({ profile: { nameFont: "Inter" } }));
    await page.goto(same.url);
    await expect(h1(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(fontFiles.size).toBe(baseline);
  });

  test("M9-24 a display name that is markup is text next to a logo, and as the alt text it is escaped", async ({
    page,
  }) => {
    const hostile = "<img src=x onerror=alert(1)>";
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    for (const placement of ["beside", "instead"] as const) {
      const live = await livePage(`lgx-${placement.slice(0, 2)}`, async (userId) => ({
        profile: { name: hostile, logo: await uploadWide(userId), logoPlacement: placement },
      }));
      await page.goto(live.url);
      await expect(page.locator("img.pg-logo")).toBeVisible();
      if (placement === "beside") await expect(h1(page)).toHaveText(hostile);
      else expect(await page.locator("img.pg-logo").getAttribute("alt")).toBe(hostile);
      expect(await page.locator("[data-page-root] img").count()).toBe(1);
      expect(dialogs).toEqual([]);
    }
  });
});

test.describe("M9-24 the Profile card: logo and placement", () => {
  const card = (page: Page) => page.getByTestId("profile-logo");

  test("M9-24 Upload logo, Instead of the name, Replace and Remove: 44px controls, the preview and the draft follow, Publish brings it to the live page, Remove changes only the draft until Publish", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "lge1");
    await openEditor(page);
    await expect(card(page)).toBeVisible();
    await expect(
      card(page).getByRole("button", { name: "Upload logo", exact: true }),
    ).toBeVisible();
    await expect(
      card(page).getByText("JPG, PNG or WebP. Shown next to your name or in place of it."),
    ).toBeVisible();
    // The placement control is disabled until a logo exists.
    const placement = card(page).getByRole("group", { name: "Logo placement", exact: true });
    await expect(placement).toHaveAttribute("aria-disabled", "true");
    await expect(
      placement.getByRole("button", { name: "Beside the name", exact: true }),
    ).toBeDisabled();

    await card(page)
      .locator("input[type=file]")
      .setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: makePng(600, 200, [30, 90, 200]),
      });
    await expect(card(page).getByRole("button", { name: "Replace logo", exact: true })).toBeVisible(
      { timeout: 30_000 },
    );
    const draft = await expectDraft(user.pageId, (d) => d.profile.logo != null);
    expect(draft.profile.logo!.path.startsWith(`${user.userId}/`)).toBe(true);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    for (const button of await card(page).getByRole("button").all()) {
      expect((await box(button)).height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);

    // Instead of the name: the preview's h1 holds the logo with the display name as its alt.
    await expect(placement).not.toHaveAttribute("aria-disabled", "true");
    await placement.getByRole("button", { name: "Instead of the name", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.profile.logoPlacement === "instead");
    await showView(page, "Preview");
    const screen = previewScreen(page);
    const displayName = (await pageRow(user.pageId)).draft.profile.name;
    await expect(screen.locator("h1.pg-name img.pg-logo")).toHaveAttribute("alt", displayName);
    await showView(page, "Blocks");

    await publishFromEditor(page);
    const live = await tenantGet(user.handle);
    expect(live.text).toContain('class="pg-logo"');
    expect(live.text).toContain(`alt="${displayName}"`);
    expect(live.text).toContain(draft.profile.logo!.path);

    // Remove: only the draft changes until Publish.
    await card(page).getByRole("button", { name: "Remove", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.profile.logo == null);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    expect((await tenantGet(user.handle)).text).toContain('class="pg-logo"');
    await publishFromEditor(page);
    expect((await tenantGet(user.handle)).text).not.toContain('class="pg-logo"');
    // The object stays in Storage while a published version still named it (the cleanup's rule).
    expect(draft.profile.logo!.path).toBeTruthy();
  });

  test("M9-24 Undo and Redo cover the logo and its placement", async ({ page, context }) => {
    const user = await seededUser(context, "lge2");
    await openEditor(page);
    await card(page)
      .locator("input[type=file]")
      .setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: makePng(300, 100),
      });
    await expect(card(page).getByRole("button", { name: "Replace logo", exact: true })).toBeVisible(
      { timeout: 30_000 },
    );
    await expectDraft(user.pageId, (d) => d.profile.logo != null);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.profile.logo == null);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.profile.logo != null);
  });

  test("M9-24 a file that is not an image is refused with the upload message under the logo control", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "lge3");
    await openEditor(page);
    await card(page)
      .locator("input[type=file]")
      .setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
      });
    await expect(card(page).getByRole("alert")).toBeVisible({ timeout: 15_000 });
    expect((await pageRow(user.pageId)).draft.profile.logo ?? null).toBeNull();
  });
});

test.describe("M9-24 the Design tab: Name font and Name size", () => {
  test("M9-24 the Fonts card has Name font (a 16px, 44px select of 'Same as headings' and the 18 families, each in its own face) and Name size (four 44px options); each change reaches the preview and the draft, and Publish makes the live page match", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "lgd1");
    await openDesign(page);
    const fonts = page.locator('[data-design-section="fonts"]');
    const select = fonts.getByTestId("name-font");
    await expect(select).toBeVisible();
    expect((await box(select)).height).toBeGreaterThanOrEqual(44);
    expect(await select.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    const options = await select
      .locator("option")
      .evaluateAll((els) => els.map((el) => el.textContent));
    expect(options).toEqual(["Same as headings", ...FONT_ALLOWLIST]);
    // Each option is drawn in its own face from the self-hosted files.
    expect(
      await select
        .locator("option", { hasText: "Fraunces" })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/hl-nf-Fraunces/);
    expect(await fonts.locator("style").first().textContent()).toContain("/_t/f/fraunces-latin.");
    expect(await fonts.locator("style").first().textContent()).not.toContain("googleapis");

    const sizes = fonts.getByRole("group", { name: "Name size", exact: true });
    for (const label of ["Small", "Medium", "Large", "Extra large"]) {
      const button = sizes.getByRole("button", { name: label, exact: true });
      expect((await box(button)).height).toBeGreaterThanOrEqual(44);
    }
    await expect(sizes.getByRole("button", { name: "Medium", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="name-style"]');

    await select.selectOption("Lora");
    await sizes.getByRole("button", { name: "Extra large", exact: true }).click();
    await expectDraft(
      user.pageId,
      (d) => d.profile.nameFont === "Lora" && d.profile.nameSize === "xlarge",
    );
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 15_000 });

    // The preview follows at once.
    await showPreview(page);
    const previewName = previewRoot(page).locator("h1.pg-name");
    await expect.poll(() => familyOf(previewName)).toMatch(/^"?Lora"?/);
    // The bezel (310px) is a narrow container: its base name size is 26px, so extra large is 39px; the
    // phone's full-size preview sheet is 390px wide, where the base is 40px and extra large 60px.
    expect(await fontSize(previewName)).toBeCloseTo(desktopOnly(info) ? 39 : 60, 0);
    const previewHtml = await previewRoot(page)
      .locator("header.pg-profile")
      .evaluate(normalizedOuterHtml);
    await showTokens(page);

    // Publish, then the live page matches the preview's profile markup.
    await publishFromEditor(page);
    // The live page at this viewport: the computed family and size are the chosen ones, and the
    // profile's markup is the preview's (compared in the browser, with the style attribute written
    // the way the browser's own CSS object model writes it).
    await page.goto(`http://${user.handle}.localhost:3000/`);
    await expect(h1(page)).toBeVisible();
    const liveHtml = await page.locator("header.pg-profile").evaluate(normalizedOuterHtml);
    expect(liveHtml).toContain('class="pg-name pg-name-xl pg-name-font"');
    expect(previewHtml).toBe(liveHtml);
    expect(await familyOf(h1(page))).toMatch(/^"?Lora"?/);
    expect(await fontSize(h1(page))).toBeCloseTo(60, 0);
    expect(desktopOnly(info) || phoneOnly(info)).toBe(true);

    // "Same as headings" takes the key out of the draft; Undo restores the font.
    await openDesign(page);
    await fonts.getByTestId("name-font").selectOption("");
    await expectDraft(user.pageId, (d) => d.profile.nameFont === undefined);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.profile.nameFont === "Lora");
  });
});

test.describe("M9-24 abuse through the publishable key and the owner's JWT", () => {
  test("M9-24 a name font, a size or a logo of another owner's folder written as raw JSON is refused at Publish with the field named, never reaches the live page and never writes a rule or a font request", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "lga1");
    const stranger = await makeUser("lga2");
    const before = (await pageRow(user.pageId)).published;
    const client = userClient(await accessToken(context));
    const cases: Record<string, Record<string, unknown>> = {
      "an unlisted font": { nameFont: "Comic Sans" },
      "a font that closes the style": { nameFont: "x;}</style><script>alert(1)</script>" },
      "a size outside the list": { nameSize: "huge" },
      "a placement outside the list": { logoPlacement: "left" },
      "a logo of user B": {
        logo: { path: `${stranger.id}/img-0123456789ab.webp`, width: 600, height: 200 },
      },
    };
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    for (const [name, bad] of Object.entries(cases)) {
      const row = await pageRow(user.pageId);
      const draft = { ...row.draft, profile: { ...row.draft.profile, ...bad } };
      const written = await client
        .from("pages")
        .update({ draft })
        .eq("id", user.pageId)
        .select("id");
      expect(written.error, name).toBeNull();
      await openEditor(page);
      await publishButton(page).click();
      await expect
        .poll(async () => JSON.stringify((await pageRow(user.pageId)).published), { message: name })
        .toBe(JSON.stringify(before));
      await page.waitForTimeout(500);
    }
    const live = await tenantGet(user.handle);
    for (const marker of [
      "Comic Sans",
      "alert(1)",
      "pg-name-",
      "pg-logo",
      "--t-font-name",
      stranger.id,
    ]) {
      expect(live.text, marker).not.toContain(marker);
    }
    // Nothing the person wrote ever became a request (the editor's own Google Fonts preview is for allowlisted names only).
    expect(requests.some((u) => /comic|alert/i.test(u))).toBe(false);
  });
});
