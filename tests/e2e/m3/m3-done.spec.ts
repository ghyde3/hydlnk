import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers, insertPage, phoneOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { showView } from "../m2/blocks-helpers";
import { setDraft } from "../m2/editor-helpers";
import { expectOverrides, openDesign, saveStatus } from "./design-helpers";
import {
  IVORY,
  NOIR,
  chooseThemeMenuItem,
  expectStoredTheme,
  liveHtml,
  messageOf,
  openEditorPage,
  previewRootOf,
  publishFromEditor,
  rootVars,
  statusChip,
  themeCard,
  themeRowsOf,
  themeUser,
} from "./themes-helpers";

/**
 * M3-25, the milestone's done-when flow, through the real Design screen, page switcher and editor at
 * both viewports (phone 390x844 and desktop 1440x900 run in parallel, so each project makes its own
 * Pro user and two pages instead of sharing mara's: two contexts autosaving one draft trip the
 * stale-tab guard). The pages stand in for mara (Noir) and maraprints (Ivory with page overrides),
 * with different content.
 *
 *   1. on page A's Design screen: accent Terracotta, radius 20, heading Fraunces, Save as theme,
 *      rename it "Shared look";
 *   2. switch to page B with the page switcher, apply "Shared look", Publish B, then Publish A;
 *      both live pages have the same `--t-*` map, equal computed styles for avatar, name, link
 *      button, card and header, and the same Google Fonts family params;
 *   3. on A's Design screen change the accent to Sage and press "Update Shared look": both live
 *      pages are byte-identical to before (and again after 5 seconds) and still Terracotta, and
 *      each page's editor says "Unpublished changes" with a Sage preview;
 *   4. Publish only A: A shows Sage, B stays Terracotta; Publish B: both match again, Sage;
 *   5. every step: no sideways scroll on either live page, and at 390 every tappable target is 44px.
 *
 * The live pages are read with raw requests (no browser cache) and compared with `<script>`
 * elements stripped, since in `next dev` their flight ids vary in length from one request to the
 * next while everything a visitor sees is stable (the call M1-06 and M2-31 made).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 300_000 });

const TERRACOTTA = "#C46A4F";
const SAGE = "#8FA68A";

function draftOf(
  tag: string,
  profile: { name: string; bio: string },
  copy: { header: string; links: [string, string]; card: string },
  theme: { ref: string; overrides: Record<string, unknown> },
) {
  return {
    version: 1,
    rev: 0,
    profile: { ...profile, photo: null },
    theme,
    blocks: [
      { id: `hdr${tag}00000`, type: "header", visible: true, text: copy.header },
      {
        id: `lnk${tag}00001`,
        type: "link",
        visible: true,
        label: copy.links[0],
        url: `https://example.com/${tag}/one`,
      },
      {
        id: `lnk${tag}00002`,
        type: "link",
        visible: true,
        label: copy.links[1],
        url: `https://example.com/${tag}/two`,
      },
      {
        id: `crd${tag}00003`,
        type: "card",
        visible: true,
        title: copy.card,
        caption: "Take a look",
        url: `https://example.com/${tag}/card`,
        image: null,
      },
    ],
  };
}

/**
 * The font families a live document uses (M8-01 replaced its Google Fonts stylesheet): the heading and
 * body families of the root's `--t-font-*` variables, which are what the page's `@font-face` rules serve.
 */
function fontParams(html: string): string[] {
  const root = /<div class="pg-root"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? "";
  const families = [...root.replaceAll("&quot;", '"').matchAll(/--t-font-(?:heading|body):"([^"]+)"/g)].map(
    (match) => match[1]!,
  );
  expect(families).toHaveLength(2);
  expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  return [...new Set(families)];
}

const PROPERTIES = [
  "color",
  "background-color",
  "border-top-left-radius",
  "font-family",
  "font-size",
  "gap",
] as const;

/** The live-page elements the step compares, by what they are. */
const PARTS: [string, string][] = [
  ["avatar", ".pg-avatar"],
  ["name", ".pg-name"],
  ["link button", ".pg-link"],
  ["card", ".pg-card"],
  ["header block", "h2.pg-header"],
  ["profile header", "header.pg-profile"],
];

async function computedOf(live: Page): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, selector] of PARTS) {
    const element = live.locator(selector).first();
    await expect(element, name).toBeVisible();
    out[name] = await element.evaluate(
      (el, props) => {
        const style = getComputedStyle(el);
        return Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop)]));
      },
      PROPERTIES as unknown as string[],
    );
  }
  return out;
}

const switcher = (page: Page): Locator =>
  page.getByRole("button", { name: /^Switch page, current:/ });

/** Switches the working page with the page switcher: the sidebar at 1440, the top-bar chip at 390. */
async function switchPage(page: Page, handle: string): Promise<void> {
  await switcher(page).click();
  await page
    .getByRole("menu", { name: "Pages" })
    // M6-14: an item reads "{page name} {handle}.hydlnk.com", so the handle is not at the start.
    .getByRole("menuitemradio", { name: new RegExp(`${handle}\\.`) })
    .click();
  await expect(switcher(page)).toHaveAttribute("aria-label", new RegExp(`current: ${handle}\\.`), {
    timeout: 20_000,
  });
}

const accentSwatch = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: `Accent ${name}`, exact: true });

async function openLive(page: Page, handle: string): Promise<Page> {
  const live = await page.context().newPage();
  await live.goto(url(handle));
  await expect(live.locator("[data-page-root]")).toBeVisible();
  return live;
}

test("M3-25 one saved theme on two pages matches exactly, stays frozen until republish, then follows each Publish", async ({
  page,
  context,
}, info) => {
  const phone = phoneOnly(info);
  // Setup: a Pro user (billing is Milestone 4; the plan is set through the secret key) with page A
  // on Noir and page B on Ivory with page overrides, each with its own content.
  const user = await themeUser(context, "m3d", "pro");
  const handleA = user.handle;
  const handleB = `zq-m3db-${rand(5)}`;
  await setDraft(
    user.pageId,
    draftOf(
      "aaaa",
      { name: "Mara Okafor", bio: "Portrait and studio photographer in Orlando." },
      {
        header: "Book a session",
        links: ["Portrait sessions", "Studio rentals"],
        card: "Night Market",
      },
      { ref: NOIR, overrides: {} },
    ),
  );
  const pageB = await insertPage(user.userId, handleB, {
    draft: draftOf(
      "bbbb",
      { name: "Maraprints", bio: "Archival prints, signed and numbered." },
      {
        header: "Shop the archive",
        links: ["New prints", "Gift cards"],
        card: "Limited editions",
      },
      { ref: IVORY, overrides: { accent: "#2B5E8C", radius: 4, buttonStyle: "pill" } },
    ),
  });
  expect(pageB).toBeTruthy();

  // ---- 1. Page A's Design screen: accent Terracotta, radius 20, heading Fraunces, Save as theme.
  await openDesign(page);
  await accentSwatch(page, "Terracotta").click();
  await expect(accentSwatch(page, "Terracotta")).toHaveAttribute("aria-pressed", "true");
  const radius = page.getByRole("group", { name: "Corner radius", exact: true });
  await radius.getByRole("button", { name: "20px", exact: true }).click();
  await expect(radius.getByRole("button", { name: "20px", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /^Heading font: / }).click();
  await page
    .getByRole("listbox", { name: "Heading font" })
    .getByRole("option", { name: "Fraunces", exact: true })
    .click();
  await expectOverrides(
    user.pageId,
    (o) => o.accent === TERRACOTTA && o.radius === 20 && o.fontHeading === "Fraunces",
    "Terracotta, 20 and Fraunces autosaved to page A's draft",
  );
  await expect(saveStatus(page)).toContainText(/saved/i);

  await page.getByRole("button", { name: "Save as theme" }).click();
  await expect.poll(async () => (await themeRowsOf(user.userId)).length).toBe(1);
  const [saved] = await themeRowsOf(user.userId);
  expect((saved!.tokens as Record<string, unknown>).accent).toBe(TERRACOTTA);
  expect((saved!.tokens as Record<string, unknown>).radius).toBe(20);
  expect((saved!.tokens as Record<string, unknown>).fontHeading).toBe("Fraunces");
  await expectStoredTheme(
    user.pageId,
    (t) => t.ref === saved!.id && Object.keys(t.overrides).length === 0,
    "page A points at the saved theme with no page overrides",
  );

  // Rename it "Shared look".
  await chooseThemeMenuItem(page, saved!.name as string, "Rename");
  const rename = page.getByTestId("theme-rename-input");
  await rename.fill("Shared look");
  await page.keyboard.press("Enter");
  await expect(rename).toHaveCount(0);
  await expect(themeCard(page, "Shared look")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await themeRowsOf(user.userId))[0]!.name).toBe("Shared look");
  const themeId = saved!.id as string;

  // ---- 2. Switch to page B with the page switcher, apply "Shared look", Publish B, then Publish A.
  await switchPage(page, handleB);
  await openDesign(page);
  await themeCard(page, "Shared look").click();
  await expect(themeCard(page, "Shared look")).toHaveAttribute("aria-pressed", "true");
  await expectStoredTheme(
    pageB,
    (t) => t.ref === themeId && Object.keys(t.overrides).length === 0,
    "page B points at Shared look with its own overrides replaced",
  );
  await publishFromEditor(page);

  await switchPage(page, handleA);
  await publishFromEditor(page);

  const liveA = await openLive(page, handleA);
  const liveB = await openLive(page, handleB);
  for (const live of [liveA, liveB]) {
    expect(await live.evaluate(() => window.innerWidth)).toBe(page.viewportSize()!.width);
  }

  const varsA = await rootVars(liveA.locator("[data-page-root]"));
  const varsB = await rootVars(liveB.locator("[data-page-root]"));
  expect(Object.keys(varsA).length).toBeGreaterThanOrEqual(23);
  expect(varsA).toEqual(varsB);
  expect(varsA.accent).toBe(TERRACOTTA);
  expect(varsA.radius).toBe("20px");
  expect(varsA["font-heading"]).toContain("Fraunces");

  expect(await computedOf(liveA)).toEqual(await computedOf(liveB));

  const htmlA1 = await liveHtml(handleA);
  const htmlB1 = await liveHtml(handleB);
  expect(fontParams(htmlA1)).toEqual(fontParams(htmlB1));
  expect(fontParams(htmlA1).some((family) => family.startsWith("Fraunces"))).toBe(true);
  // Different content on the two pages, the same look.
  expect(htmlA1).toContain("Mara Okafor");
  expect(htmlB1).toContain("Maraprints");
  expect(htmlA1).not.toContain("Maraprints");

  // ---- 3. Update "Shared look" with Sage from page A's Design screen: both live pages stay frozen.
  await openDesign(page);
  await accentSwatch(page, "Sage").click();
  await expect(accentSwatch(page, "Sage")).toHaveAttribute("aria-pressed", "true");
  const update = page.getByTestId("theme-update");
  await expect(update).toHaveText("Update Shared look");
  await update.click();
  await expect(messageOf(page)).toContainText("Updated Shared look.");
  await expect
    .poll(async () => (await themeRowsOf(user.userId))[0]!.tokens as Record<string, unknown>)
    .toMatchObject({ accent: SAGE });

  expect(await liveHtml(handleA)).toBe(htmlA1);
  expect(await liveHtml(handleB)).toBe(htmlB1);
  await page.waitForTimeout(5_000);
  const htmlA2 = await liveHtml(handleA);
  const htmlB2 = await liveHtml(handleB);
  expect(htmlA2).toBe(htmlA1);
  expect(htmlB2).toBe(htmlB1);
  expect(htmlA2).toContain(TERRACOTTA);
  expect(htmlB2).toContain(TERRACOTTA);
  expect(htmlA2).not.toContain(SAGE);
  expect(htmlB2).not.toContain(SAGE);
  // The open browser tabs are frozen too: a reload still draws Terracotta.
  for (const live of [liveA, liveB]) {
    await live.reload();
    expect((await rootVars(live.locator("[data-page-root]"))).accent).toBe(TERRACOTTA);
  }

  // Each page's editor says there are unpublished changes, and its preview already shows Sage.
  for (const handle of [handleA, handleB]) {
    await switchPage(page, handle);
    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    if (phone) await showView(page, "Preview");
    await expect
      .poll(async () => (await rootVars(previewRootOf(page))).accent, { timeout: 15_000 })
      .toBe(SAGE);
    if (phone) await showView(page, "Blocks"); // close the sheet: it covers the page switcher
  }

  // ---- 4. Publish only page A: A shows Sage, B stays Terracotta; then Publish B: both match again.
  await switchPage(page, handleA);
  await publishFromEditor(page);
  const htmlA3 = await liveHtml(handleA);
  expect(htmlA3).toContain(SAGE);
  expect(htmlA3).not.toContain(TERRACOTTA);
  expect(await liveHtml(handleB)).toBe(htmlB1);
  await liveA.reload();
  await liveB.reload();
  expect((await rootVars(liveA.locator("[data-page-root]"))).accent).toBe(SAGE);
  expect((await rootVars(liveB.locator("[data-page-root]"))).accent).toBe(TERRACOTTA);

  await switchPage(page, handleB);
  await publishFromEditor(page);
  await liveA.reload();
  await liveB.reload();
  const finalA = await rootVars(liveA.locator("[data-page-root]"));
  const finalB = await rootVars(liveB.locator("[data-page-root]"));
  expect(finalA).toEqual(finalB);
  expect(finalA.accent).toBe(SAGE);
  expect(await computedOf(liveA)).toEqual(await computedOf(liveB));
  expect(fontParams(await liveHtml(handleA))).toEqual(fontParams(await liveHtml(handleB)));

  // ---- 5. Both live pages fit the viewport; at 390 every tappable target is 44px.
  for (const live of [liveA, liveB]) {
    await expectNoHorizontalScroll(live);
    if (phone) await expectTapTargets(live);
  }
  await liveA.close();
  await liveB.close();
});
