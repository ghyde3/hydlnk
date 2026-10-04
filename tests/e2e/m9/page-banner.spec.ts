import { expect, test, type Page } from "@playwright/test";
import { DESKTOP, PHONE } from "../../../scripts/lib/viewports";
import { adminClient, userClient } from "../fixtures/auth";
import { expireOwnerPages } from "../fixtures/expire";
import { cleanupUsers, desktopOnly, phoneOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { dayAt, makeOwner, seed, signInOwner } from "../m4/analytics-dash-helpers";
import { accessToken, expectDraft, pageRow, seededUser, statusChip } from "../m2/editor-helpers";
import { openEditor, previewScreen, showView } from "../m2/blocks-helpers";
import { toPublishForm, emptyDraft } from "@/lib/document";
import { tenantGet } from "../m2/publish-helpers";
import {
  eventsOf,
  getClick,
  waitForClicks,
  waitForEvents,
  type IngestPage,
} from "../m4/analytics-ingest-helpers";
import {
  BLOCKS,
  box,
  eventRows,
  livePage,
  publishButton,
  publishFromEditor,
  words,
} from "./page-helpers";

/**
 * M9-23: the support banner, end to end. The public page (the bar, its link, the dismissal with no
 * script, no cookie and no request), the redirect behind its link (counted, 404 once removed), the
 * editor's Banner card (switch, fields, preview, Publish, errors, the blocked-site message) and the
 * direct-write abuse cases. Each test makes its own user.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const BANNER_ID = "banner-e2e-001";
const TARGET = "https://example.com/sale";
const MESSAGE = words(100);
const LABEL = words(30, "L");
const banner = (extra: Record<string, unknown> = {}) => ({
  id: BANNER_ID,
  visible: true,
  text: MESSAGE,
  label: LABEL,
  url: TARGET,
  ...extra,
});

const aside = (page: Page) => page.locator("aside#pg-banner");
const columnTop = (page: Page) =>
  page.locator(".pg-column").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

test.describe("M9-23 the bar on the public page", () => {
  test("M9-23 a 100-character message and a 30-character label: the bar spans the page, its content is centered, the link and the dismiss are 44px", async ({
    page,
  }, info) => {
    const live = await livePage("bnp1", () => ({ banner: banner() }));
    await page.goto(live.url);
    const bar = aside(page);
    await expect(bar).toBeVisible();
    const view = page.viewportSize()!;

    // The first child of the page root, before the profile column; not sticky.
    expect(
      await page
        .locator("[data-page-root] > *")
        .evaluateAll((els) => els.map((el) => el.className)),
    ).toEqual(expect.arrayContaining(["pg-banner", "pg-column"]));
    expect(
      await page.locator("[data-page-root]").evaluate((root) => root.firstElementChild!.id),
    ).toBe("pg-banner");
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
    expect(await bar.getAttribute("aria-label")).toBe("Message");

    // A bar across the page's width, content centered in at most 480px.
    const barBox = await box(bar);
    expect(Math.round(barBox.width)).toBe(view.width);
    expect(Math.round(barBox.x)).toBe(0);
    const parts = await bar.locator("> *").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
    const left = Math.min(...parts.map((p) => p.left));
    const right = Math.max(...parts.map((p) => p.right));
    expect(right - left).toBeLessThanOrEqual(480.5);
    expect(Math.abs((left + right) / 2 - view.width / 2)).toBeLessThanOrEqual(3);

    // The text wraps inside the bar; the link and the dismiss anchor are each at least 44px.
    await expect(bar.locator(".pg-banner-text")).toHaveText(MESSAGE);
    const link = bar.locator("a.pg-banner-link");
    await expect(link).toHaveText(LABEL);
    expect((await box(link)).height).toBeGreaterThanOrEqual(44);
    const dismiss = bar.getByRole("link", { name: "Dismiss message" });
    expect((await box(dismiss)).height).toBeGreaterThanOrEqual(44);
    expect((await box(dismiss)).width).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "aside#pg-banner");

    // Drawn with the page's tokens, the link underlined in the accent color.
    expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain(
      "underline",
    );

    if (phoneOnly(info)) {
      // At 390 the bar is the column's width and the text wraps onto several lines.
      expect((await box(bar.locator(".pg-banner-text"))).height).toBeGreaterThan(30);
    } else {
      // At 1440 the page below it is the usual column, centered, right under the bar.
      const column = await box(page.locator(".pg-column"));
      expect(column.width).toBeLessThanOrEqual(480.5);
      expect(Math.abs(column.x + column.width / 2 - view.width / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(column.y - (barBox.y + barBox.height))).toBeLessThanOrEqual(1);
    }
  });

  test("M9-23 dismissing hides the bar for this visit with no script, cookie, storage, request or event; a reload keeps it hidden and a fresh visit shows it again", async ({
    page,
  }) => {
    const live = await livePage("bnp2", () => ({ banner: banner() }));
    await page.goto(live.url);
    await expect(aside(page)).toBeVisible();
    // The page's own view beacon is the one event; wait for it, then nothing else may follow.
    await waitForEvents(live.pageId, 1);
    const eventsBefore = (await eventRows(live.pageId)).length;
    const before = await columnTop(page);
    const barHeight = (await box(aside(page))).height;

    const requests: string[] = [];
    page.on("request", (request) =>
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`),
    );
    await aside(page).getByRole("link", { name: "Dismiss message" }).click();

    await expect(aside(page)).toBeHidden();
    expect(page.url()).toBe(`${live.url}#pg-banner`);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The content below moves up by the banner's height.
    await expect.poll(() => columnTop(page)).toBeCloseTo(before - barHeight, 0);
    await expectNoHorizontalScroll(page);

    // Nothing was stored, sent or recorded.
    expect(await page.evaluate(() => document.cookie)).toBe("");
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await page.waitForTimeout(1000);
    expect(requests).toEqual([]);
    expect((await eventRows(live.pageId)).length).toBe(eventsBefore);

    // The dismissal lasts while the URL keeps the fragment ...
    await page.reload();
    await expect(page.locator("[data-page-root]")).toBeVisible();
    await expect(aside(page)).toBeHidden();
    // ... and a fresh visit shows the banner again: tenant pages never read or set cookies.
    await page.goto(live.url);
    await expect(aside(page)).toBeVisible();
  });

  test("M9-23 with JavaScript off the dismissal still works, and the page makes no request to a third party", async ({
    browser,
  }, info) => {
    const live = await livePage("bnp3", () => ({
      banner: banner({ text: "Short news", label: "Read" }),
    }));
    const context = await browser.newContext({
      ...(info.project.name === "phone" ? PHONE : DESKTOP),
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    await page.goto(live.url);
    await expect(aside(page)).toBeVisible();
    await aside(page).getByRole("link", { name: "Dismiss message" }).click();
    await expect(aside(page)).toBeHidden();
    expect([...hosts]).toEqual([`${live.handle}.localhost:3000`]);
    await context.close();
  });

  test("M9-23 a page without a banner is unchanged, and a hidden banner's text appears nowhere", async ({
    page,
  }) => {
    const plain = await livePage("bnp4", () => ({}));
    const hidden = await livePage("bnp5", () => ({}));
    // A hidden banner is dropped at Publish, so a stored document never holds one; a page whose draft
    // has one still publishes without it. The live page of both is the same.
    await adminClient()
      .from("pages")
      .update({
        draft: {
          ...(await pageRow(hidden.pageId)).draft,
          banner: banner({ visible: false, text: "SECRET-HIDDEN-TEXT" }),
        },
      })
      .eq("id", hidden.pageId);
    for (const live of [plain, hidden]) {
      await page.goto(live.url);
      await expect(page.locator("[data-page-root]")).toBeVisible();
      await expect(page.locator("aside, .pg-banner, [data-banner]")).toHaveCount(0);
      expect(await page.content()).not.toContain("SECRET-HIDDEN-TEXT");
      expect(await page.content()).not.toContain("pg-banner");
    }
  });

  test("M9-23 a message of markup is text; the destination is never in the page", async ({
    page,
  }) => {
    const live = await livePage("bnp6", () => ({
      banner: banner({ text: "<img src=x onerror=alert(1)>", label: "<b>Go</b>" }),
    }));
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(live.url);
    await expect(aside(page).locator(".pg-banner-text")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(aside(page).locator("a.pg-banner-link")).toHaveText("<b>Go</b>");
    expect(await aside(page).locator("img, b").count()).toBe(0);
    expect(dialogs).toEqual([]);
    expect(await page.content()).not.toContain(TARGET);
  });
});

test.describe("M9-23 budget and analytics", () => {
  test("M9-23 a first visit: the bar is in the server HTML, so nothing shifts (layout shift at most 0.05), and every request goes to the page's own host", async ({
    browser,
  }, info) => {
    const live = await livePage("bnb1", () => ({ banner: banner() }));
    const context = await browser.newContext(info.project.name === "phone" ? PHONE : DESKTOP);
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    await page.goto(live.url);
    await expect(aside(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(
      await page.evaluate(() => (window as unknown as { __cls: number }).__cls),
    ).toBeLessThanOrEqual(0.05);
    expect([...hosts]).toEqual([`${live.handle}.localhost:3000`]);
    await context.close();
  });

  test("M9-23 'Clicks by link' names the banner's link 'Banner: {label}', and 'Removed link' once the banner is gone", async ({
    page,
    context,
  }) => {
    const owner = await makeOwner("bna3", "pro");
    const draft = { ...emptyDraft(owner.handle), banner: banner({ text: "Sale", label: "Shop" }) };
    const withBanner = toPublishForm(draft as never, null);
    const publish = async (doc: unknown) => {
      const { error } = await adminClient()
        .from("pages")
        .update({ published: doc, published_at: new Date().toISOString() })
        .eq("id", owner.pageId);
      expect(error).toBeNull();
    };
    await publish(withBanner);
    const day = dayAt(-3);
    await seed(owner.pageId, [
      ...Array.from({ length: 4 }, (_, i) => ({
        type: "click" as const,
        day,
        blockId: BANNER_ID,
        visitor: `${"c".repeat(63)}${i}`,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        type: "view" as const,
        day,
        visitor: `${"d".repeat(63)}${i}`,
      })),
    ]);
    await signInOwner(context, owner);
    await page.goto(url("app", "/analytics"));
    const card = page.getByTestId("links-card");
    await expect(card.getByRole("heading", { name: "Clicks by link" })).toBeVisible();
    const row = card.getByTestId("link-row").first();
    await expect(row.getByRole("cell").first()).toHaveText("Banner: Shop");
    await expect(row).toContainText("4");

    await publish(toPublishForm({ ...draft, banner: undefined } as never, null));
    await page.reload();
    await expect(card.getByTestId("link-row").first().getByRole("cell").first()).toHaveText(
      "Removed link",
    );
  });
});

test.describe("M9-23 the link behind the bar: /r, counted, 404 when gone", () => {
  const ingest = (live: Awaited<ReturnType<typeof livePage>>): IngestPage =>
    ({ host: live.host, origin: live.origin, pageId: live.pageId }) as IngestPage;

  test("M9-23 tapping the link goes through /r to the published address and records one click for the banner id", async ({
    page,
  }) => {
    const live = await livePage("bnr1", () => ({
      banner: banner({ text: "Sale", label: "Shop" }),
    }));
    await page.route("https://example.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>sale</title>" }),
    );
    await page.goto(live.url);
    await expect(aside(page).locator("a.pg-banner-link")).toHaveAttribute(
      "href",
      `/r/${live.pageId}/${BANNER_ID}`,
    );
    await expect(aside(page).locator("a.pg-banner-link")).toHaveAttribute(
      "rel",
      "nofollow noopener",
    );
    await aside(page).locator("a.pg-banner-link").click();
    await page.waitForURL(TARGET);
    const clicks = await waitForClicks(live.pageId, 1);
    expect(clicks[0]).toMatchObject({ type: "click", block_id: BANNER_ID });
  });

  test("M9-23 GET /r/<page>/<banner id> answers 302 to exactly the published address, never stored, with no cookie; open-redirect parameters change nothing", async () => {
    const live = await livePage("bnr2", () => ({
      banner: banner({ text: "Sale", label: "Shop" }),
    }));
    const response = await getClick(ingest(live), BANNER_ID);
    expect(response.status).toBe(302);
    expect(response.location).toBe(TARGET);
    expect(response.headers["cache-control"]).toMatch(/no-store|no-cache/);
    expect(response.setCookies).toEqual([]);
    const rows = (await waitForClicks(live.pageId, 1)).filter((row) => row.type === "click");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.block_id).toBe(BANNER_ID);

    for (const query of [
      "?url=https://evil.example",
      "?to=//evil.example&redirect=http://evil.example",
      "?next=javascript:alert(1)",
    ]) {
      const again = await getClick(ingest(live), BANNER_ID, { query });
      expect(again.status).toBe(302);
      expect(again.location).toBe(TARGET);
    }
  });

  test("M9-23 an id that is only in the draft, in another page, hidden, or removed answers 404 and records nothing", async ({
    browser,
  }) => {
    const live = await livePage("bnr3", () => ({
      banner: banner({ text: "Sale", label: "Shop" }),
    }));
    const other = await livePage("bnr4", () => ({ banner: banner({ id: "banner-other-1" }) }));
    // The draft holds a banner the published page does not.
    await adminClient()
      .from("pages")
      .update({
        draft: {
          ...(await pageRow(live.pageId)).draft,
          banner: {
            id: "banner-draft-1",
            visible: true,
            text: "d",
            label: "d",
            url: "https://example.com/d",
          },
        },
      })
      .eq("id", live.pageId);

    for (const [id, pageId] of [
      ["banner-draft-1", live.pageId],
      ["banner-other-1", live.pageId],
      [BANNER_ID, other.pageId],
      ["banner", live.pageId],
      ["banner-nope-01", live.pageId],
    ] as const) {
      const response = await getClick(ingest(live), id, { pageId });
      expect(response.status, `${id} on ${pageId}`).toBe(404);
      expect(response.location).toBeNull();
    }
    expect((await eventsOf(live.pageId)).filter((row) => row.type === "click")).toEqual([]);

    // Removing the banner and republishing: the same id now answers 404.
    const first = await getClick(ingest(live), BANNER_ID);
    expect(first.status).toBe(302);
    const { published } = (await pageRow(live.pageId)) as { published: Record<string, unknown> };
    const without = { ...published };
    delete without.banner;
    await adminClient().from("pages").update({ published: without }).eq("id", live.pageId);
    // A write behind the server's back: on a production build the cached click target is expired the
    // way the product does it (M9-13), as Publish would.
    await expireOwnerPages(browser, live.userId);
    const removed = await getClick(ingest(live), BANNER_ID);
    expect(removed.status).toBe(404);
  });

  test("M9-23 a message-only banner has no link element and its id answers 404", async ({
    page,
  }) => {
    const live = await livePage("bnr5", () => ({ banner: banner({ label: "", url: "" }) }));
    await page.goto(live.url);
    await expect(aside(page).locator(".pg-banner-text")).toBeVisible();
    await expect(aside(page).locator("a.pg-banner-link")).toHaveCount(0);
    expect((await getClick(ingest(live), BANNER_ID)).status).toBe(404);
  });
});

test.describe("M9-23 the Banner card in the editor", () => {
  const card = (page: Page) => page.getByTestId("banner-card");
  const sw = (page: Page) =>
    card(page).getByRole("button", { name: "Show a message at the top of your page" });
  const message = (page: Page) => card(page).getByLabel("Message", { exact: true });
  const label = (page: Page) => card(page).getByLabel("Link label", { exact: true });
  const address = (page: Page) => card(page).getByLabel("Link address", { exact: true });

  test("M9-23 the card sits under the Profile card, off by default; its controls are 44px tall with 16px text and nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "bne1");
    await openEditor(page);
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole("heading", { name: "Banner" })).toBeVisible();
    const profile = await box(page.getByTestId("profile-card"));
    const bannerBox = await box(card(page));
    expect(bannerBox.y).toBeGreaterThan(profile.y + profile.height - 1);
    expect(Math.abs(bannerBox.x - profile.x)).toBeLessThanOrEqual(1);
    await expect(sw(page)).toHaveAttribute("aria-pressed", "false");
    await expect(message(page)).toHaveCount(0);

    await sw(page).click();
    await expect(sw(page)).toHaveAttribute("aria-pressed", "true");
    for (const field of [message(page), label(page), address(page)]) {
      await expect(field).toBeVisible();
      expect((await box(field)).height).toBeGreaterThanOrEqual(44);
      expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    }
    await expect(card(page).getByText("0 / 100")).toBeVisible();
    await expect(card(page).getByText("0 / 30")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="banner-card"]');
    if (desktopOnly(info)) {
      expect(bannerBox.width).toBeLessThanOrEqual(720);
    }
    expect(phoneOnly(info) || desktopOnly(info)).toBe(true);
  });

  test("M9-23 typing a message and a link: the preview draws the bar, the chip says Unpublished changes, the draft holds it, Publish puts it on the live page, and the destination stays out of the markup", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bne2");
    await openEditor(page);
    await expect(statusChip(page)).toHaveText("Published");

    await sw(page).click();
    await message(page).fill("Free shipping this week");
    await label(page).fill("Shop now");
    await address(page).fill("https://example.com/shop");
    await address(page).blur();

    await expect(statusChip(page)).toHaveText("Unpublished changes");
    const draft = await expectDraft(
      user.pageId,
      (d) => d.banner?.url === "https://example.com/shop",
    );
    expect(draft.banner).toMatchObject({
      visible: true,
      text: "Free shipping this week",
      label: "Shop now",
    });
    expect(draft.banner!.id).toMatch(/^[A-Za-z0-9_-]{8,24}$/);

    // The preview draws the bar; its dismiss anchor does nothing there.
    await showView(page, "Preview");
    const screen = previewScreen(page);
    await expect(screen.locator("aside.pg-banner .pg-banner-text")).toHaveText(
      "Free shipping this week",
    );
    await expect(screen.locator("aside.pg-banner a.pg-banner-link")).toHaveText("Shop now");
    const hrefBefore = page.url();
    await screen.getByRole("link", { name: "Dismiss message" }).click();
    expect(page.url()).toBe(hrefBefore);
    await expect(screen.locator("aside.pg-banner")).toBeVisible();
    await showView(page, "Blocks");

    await publishFromEditor(page);
    const live = await tenantGet(user.handle);
    expect(live.text).toContain('<aside class="pg-banner" id="pg-banner" aria-label="Message">');
    expect(live.text).toContain(`/r/${user.pageId}/${draft.banner!.id}`);
    expect(live.text).not.toContain("example.com/shop");
    expect(live.text.indexOf('<aside class="pg-banner"')).toBeLessThan(
      live.text.indexOf('<div class="pg-column"'),
    );
  });

  test("M9-23 turning the switch off keeps what was typed; turning it on again brings it back; an empty banner leaves no key in the draft", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bne3");
    await openEditor(page);
    await sw(page).click();
    await message(page).fill("Back soon");
    await expectDraft(user.pageId, (d) => d.banner?.text === "Back soon");

    await sw(page).click();
    await expect(sw(page)).toHaveAttribute("aria-pressed", "false");
    await expect(message(page)).toHaveCount(0);
    const hidden = await expectDraft(user.pageId, (d) => d.banner?.visible === false);
    expect(hidden.banner!.text).toBe("Back soon");
    // A hidden banner is not part of the page: nothing to publish, the chip is back to Published.
    await expect(statusChip(page)).toHaveText("Published");

    await sw(page).click();
    await expect(message(page)).toHaveValue("Back soon");
    await expectDraft(user.pageId, (d) => d.banner?.visible === true);

    // Emptied and switched off: the banner is gone from the draft.
    await message(page).fill("");
    await sw(page).click();
    await expectDraft(user.pageId, (d) => d.banner === undefined);
  });

  test("M9-23 Undo and Redo cover the banner; a reload keeps it", async ({ page, context }) => {
    const user = await seededUser(context, "bne4");
    await openEditor(page);
    await sw(page).click();
    await message(page).fill("One");
    await expectDraft(user.pageId, (d) => d.banner?.text === "One");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.banner === undefined || d.banner.text === "");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.banner?.text === "One");
    await page.reload();
    await expect(message(page)).toHaveValue("One");
  });

  test("M9-23 Publish names the field: a link without a label, then a blocked site; the card takes focus on the first error", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bne5");
    await openEditor(page);
    await sw(page).click();
    await message(page).fill("Sale");
    await address(page).fill("https://example.com/sale");
    await address(page).blur();
    await expectDraft(user.pageId, (d) => d.banner?.url === "https://example.com/sale");

    await publishButton(page).click();
    await expect(card(page).getByText("Add a label for the link.")).toBeVisible();
    await expect(label(page)).toBeFocused();
    expect((await pageRow(user.pageId)).published).not.toBeNull();
    await expect(statusChip(page)).toHaveText("Unpublished changes");

    // Fixing it clears the error at once.
    await label(page).fill("Shop");
    await expect(card(page).getByText("Add a label for the link.")).toHaveCount(0);

    // A link to a listed site is refused with the blocked-site message under the exact field.
    const domain = `ban${rand(8)}.example`;
    const inserted = await adminClient().from("blocked_domains").insert({ domain, reason: "test" });
    expect(inserted.error).toBeNull();
    try {
      await address(page).fill(`https://${domain}/sale`);
      await address(page).blur();
      await expect(card(page).getByText("That site is blocked. Use a different link.")).toBeVisible(
        {
          timeout: 15_000,
        },
      );
      // Changing the address clears it.
      await address(page).fill("https://example.com/sale");
      await expect(card(page).getByText("That site is blocked. Use a different link.")).toHaveCount(
        0,
      );
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", domain);
    }
  });
});

test.describe("M9-23 abuse through the publishable key and the owner's JWT", () => {
  test("M9-23 a banner written as raw JSON with 5,000 characters, a data: address or an id equal to a block's id is refused at Publish and never reaches the live page", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "bna1");
    const before = (await pageRow(user.pageId)).published;
    const client = userClient(await accessToken(context));
    const cases: Record<string, Record<string, unknown>> = {
      "5,000 characters": {
        id: "banner-abuse-1",
        visible: true,
        text: "x".repeat(5000),
        label: "",
        url: "",
      },
      "a data: address": {
        id: "banner-abuse-2",
        visible: true,
        text: "hi",
        label: "go",
        url: "data:text/html,x",
      },
      "a javascript: address": {
        id: "banner-abuse-3",
        visible: true,
        text: "hi",
        label: "go",
        url: "javascript:alert(1)",
      },
      "an id of a block": { id: BLOCKS[0]!.id, visible: true, text: "hi", label: "", url: "" },
    };
    await openEditor(page);
    for (const [name, bad] of Object.entries(cases)) {
      const row = await pageRow(user.pageId);
      const draft = {
        ...row.draft,
        blocks: [...row.draft.blocks.filter((b) => b.id !== BLOCKS[0]!.id), BLOCKS[0]],
        banner: bad,
      };
      const written = await client
        .from("pages")
        .update({ draft })
        .eq("id", user.pageId)
        .select("id");
      expect(written.error, name).toBeNull();
      await page.reload();
      await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
      await publishButton(page).click();
      // Refused: nothing is published, and the page is not saved over.
      await expect
        .poll(async () => JSON.stringify((await pageRow(user.pageId)).published), { message: name })
        .toBe(JSON.stringify(before));
    }
    const live = await tenantGet(user.handle);
    expect(live.text).not.toContain("javascript:alert");
    expect(live.text).not.toContain("data:text/html");
    expect(live.text).not.toContain("xxxxxxxxxx");
    expect(live.text).not.toContain("pg-banner");
  });

  test("M9-23 the owner's JWT cannot write the published document: a banner cannot be put on the live page directly", async ({
    context,
  }) => {
    const user = await seededUser(context, "bna2");
    const client = userClient(await accessToken(context));
    const { data, error } = await client
      .from("pages")
      .update({ published: { banner: { id: "x", text: "owned" } } })
      .eq("id", user.pageId)
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const live = await tenantGet(user.handle);
    expect(live.text).not.toContain("owned");
  });
});
