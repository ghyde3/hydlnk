import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "../fixtures/auth";
import { cleanupUsers, insertPage, makeUser, phoneOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { openEditor, previewScreen, showView, uploadImage } from "../m2/blocks-helpers";
import { pageRow } from "../m2/editor-helpers";
import { emptyDraft } from "@/lib/document";
import { publishFromEditor } from "./blocks-fcd-helpers";
import { markupOf } from "./store-blocks-helpers";

/**
 * M9-15 steps 10 and 11: the Wave K document contract end to end. A page that holds one block of
 * each new type and every page-level key opens in the editor, the preview and the share page without
 * an error and without sideways scroll (with 44px targets on a phone), and after Publish the live
 * page draws the same markup as the preview for each of them. The per-feature specs prove each
 * type on its own; this is the one place they meet on one page.
 */

test.describe.configure({ timeout: 180_000 });
test.afterAll(cleanupUsers);

const LINK_ID = "ct-link-00001";
const LOCKED_ID = "ct-link-00002";
const FAQ_ID = "ct-faq-000001";
const CONTACT_ID = "ct-contact-001";
const DISCOUNT_ID = "ct-discount-01";
const BOOK_ID = "ct-book-000001";
const APPS_ID = "ct-apps-000001";
const MAP_ID = "ct-map-0000001";
const NEW_BLOCKS = [FAQ_ID, CONTACT_ID, DISCOUNT_ID, BOOK_ID, APPS_ID, MAP_ID] as const;
const TYPES: Record<string, string> = {
  [FAQ_ID]: "faq",
  [CONTACT_ID]: "contact",
  [DISCOUNT_ID]: "discount",
  [BOOK_ID]: "book",
  [APPS_ID]: "apps",
  [MAP_ID]: "map",
};
const BANNER_ID = "ct-banner-0001";

/** A Pro user (redirect mode is Pro) whose draft holds everything Wave K added, signed in on `page`. */
async function setup(page: Page, label: string, opts: { redirect: boolean }) {
  const user = await makeUser(label, { plan: "pro" });
  const handle = `zq-${label}-${rand(5)}`;
  const cover = await uploadImage(user.id, 400, 600);
  const logo = await uploadImage(user.id, 600, 200, [30, 90, 200]);
  const base = emptyDraft(handle);
  const draft = {
    ...base,
    profile: {
      ...base.profile,
      name: "Mara Okafor",
      bio: "Photographer in Orlando",
      logo,
      logoPlacement: "beside",
      nameFont: "Fraunces",
      nameSize: "large",
    },
    banner: {
      id: BANNER_ID,
      visible: true,
      text: "Spring sale, ends Sunday",
      label: "Shop",
      url: "https://example.com/sale",
    },
    utm: { source: "hydlnk", medium: "link-in-bio", campaign: "spring" },
    ...(opts.redirect ? { redirect: { linkId: LINK_ID } } : {}),
    blocks: [
      {
        id: LINK_ID,
        type: "link",
        visible: true,
        label: "Portraits",
        url: "https://example.com/portraits",
        utm: { source: "newsletter" },
      },
      {
        id: LOCKED_ID,
        type: "link",
        visible: true,
        label: "Members only",
        url: "https://example.com/members",
        lock: { kind: "age" },
      },
      {
        id: FAQ_ID,
        type: "faq",
        visible: true,
        items: [
          { id: "ct-faq-q-0001", question: "Do you travel?", answer: "Yes, worldwide." },
          { id: "ct-faq-q-0002", question: "Film or digital?", answer: "Both.\nAsk for details." },
        ],
      },
      {
        id: CONTACT_ID,
        type: "contact",
        visible: true,
        name: "Mara Okafor",
        phone: "+1 555 123 4567",
        email: "mara@example.com",
        hours: "Mon to Fri\n9 to 5",
      },
      {
        id: DISCOUNT_ID,
        type: "discount",
        visible: true,
        code: "SPRING20",
        description: "20% off prints",
        url: "https://example.com/shop",
      },
      {
        id: BOOK_ID,
        type: "book",
        visible: true,
        title: "The Night Market",
        author: "Mara Okafor",
        cover,
        links: [
          { id: "ct-book-l-0001", store: "amazon", url: "https://example.com/amazon" },
          { id: "ct-book-l-0002", store: "bookshop", url: "https://example.com/bookshop" },
        ],
      },
      {
        id: APPS_ID,
        type: "apps",
        visible: true,
        links: [
          { id: "ct-apps-l-0001", store: "appstore", url: "https://example.com/ios" },
          { id: "ct-apps-l-0002", store: "googleplay", url: "https://example.com/android" },
        ],
      },
      {
        id: MAP_ID,
        type: "map",
        visible: true,
        name: "Okafor Studio",
        address: "12 Orange Ave, Orlando, FL",
        googleId: "ct-map-g-00001",
        appleId: "ct-map-a-00001",
      },
    ],
  };
  const pageId = await insertPage(user.id, handle, { draft });
  await signInAs(page.context(), user.email);
  return { ...user, handle, pageId };
}

/** Everything the page and its console say that is an error. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/**
 * The name's classes, text and font family. Its `style` attribute is the same declaration in both,
 * but the browser serializes one it set through the CSS object model (the preview) with spaces and a
 * semicolon and one it parsed from HTML (the live page) without, so the markup is not compared.
 */
function nameOf(scope: Page, selector: string) {
  return scope
    .locator(selector)
    .first()
    .evaluate((el) => ({
      className: el.className,
      text: el.textContent,
      fontFamily: getComputedStyle(el).fontFamily,
    }));
}

/** An element's markup with its attributes sorted, as `markupOf` does for a block. */
function markupBySelector(scope: Page, selector: string): Promise<string> {
  return scope
    .locator(selector)
    .first()
    .evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
        const attributes = Array.from(node.attributes)
          .map((attribute) => [attribute.name, attribute.value] as const)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        for (const [name] of attributes) node.removeAttribute(name);
        for (const [name, value] of attributes) node.setAttribute(name, value);
      }
      return clone.outerHTML;
    });
}

test("M9-15 a page with one block of each new type and every page-level key opens in the editor, the preview and the share page: no error, no sideways scroll, 44px targets on a phone", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await setup(page, "ct1", { redirect: true });

  await openEditor(page);
  // Eight blocks (two links and the six new types), each with its own row.
  await expect(page.locator("li[data-block-id]")).toHaveCount(8);
  await expectNoHorizontalScroll(page);
  if (phoneOnly(info)) await expectTapTargets(page, "[role='tabpanel']");

  // The preview draws the six new types (the redirect is the live page's behavior only).
  await showView(page, "Preview");
  for (const id of NEW_BLOCKS) {
    await expect(
      previewScreen(page).locator(`[data-block-id="${id}"][data-block-type="${TYPES[id]}"]`),
      id,
    ).toBeVisible();
  }
  await expect(previewScreen(page).locator("aside.pg-banner")).toBeVisible();
  await expect(previewScreen(page).locator("img.pg-logo")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The share page opens: the QR card, the link tracking card and the redirect card are on it.
  await page.goto(url("app", "/share"));
  await expect(page.getByRole("heading", { name: "Link tracking", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Redirect mode", exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (phoneOnly(info)) await expectTapTargets(page, "[role='tabpanel']");

  expect(errors).toEqual([]);
});

test("M9-15 after Publish the live page draws each new block, the banner and the profile exactly as the preview does", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const owner = await setup(page, "ct2", { redirect: false });

  await openEditor(page);
  await showView(page, "Preview");
  const preview: Record<string, string> = {};
  for (const id of NEW_BLOCKS) preview[id] = await markupOf(previewScreen(page), id);
  const previewBanner = await markupBySelector(
    page,
    "[data-testid=preview-screen] aside.pg-banner",
  );
  const previewLogo = await markupBySelector(page, "[data-testid=preview-screen] img.pg-logo");
  const previewName = await nameOf(page, "[data-testid=preview-screen] .pg-name");

  await showView(page, "Blocks");
  await publishFromEditor(page, owner.pageId);
  const stored = await pageRow(owner.pageId);
  expect((stored.published as { blocks: unknown[] }).blocks).toHaveLength(8);

  const live = await page.context().newPage();
  const liveErrors = trackErrors(live);
  await live.goto(url(owner.handle));
  await expect(live.locator("[data-page-root]")).toBeVisible();
  for (const id of NEW_BLOCKS) {
    // The one thing the live page adds is `data-js` on a discount block, set by the tenant script at load (M9-19).
    const liveMarkup = (await markupOf(live.locator("[data-page-root]"), id)).replace(
      / data-js=""/g,
      "",
    );
    expect(liveMarkup, id).toBe(preview[id]);
  }
  expect(await markupBySelector(live, "aside.pg-banner")).toBe(previewBanner);
  expect(await markupBySelector(live, "img.pg-logo")).toBe(previewLogo);
  expect(await nameOf(live, ".pg-name")).toEqual(previewName);
  await expectNoHorizontalScroll(live);
  await live.close();

  expect(errors).toEqual([]);
  expect(liveErrors).toEqual([]);
});
