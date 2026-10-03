import { expect, test, type Browser, type Page } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import {
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  rand,
  signedInUser,
} from "../fixtures/data";
import { url } from "../helpers";
import { accessToken, openEditor, pageRow, previewScreen, statusChip } from "../m2/editor-helpers";
import { publishDocOf } from "../m2/blocks-helpers";
import { tenantGet } from "../m2/publish-helpers";
import { halves, uploadImage } from "./images-helpers";
import { COLOR, blockIn } from "./block-style-helpers";
import type { Block } from "@/lib/document";

/**
 * M6-45 abuse cases through the real doors: the owner writes a draft with the publishable key and
 * their own JWT (PostgREST, RLS applies), which the database takes like any draft; Publish then
 * keeps only the ten allowed override keys, or refuses the draft naming the block and the fix, and
 * writes nothing; the live page never shows any of it. A published row holding a hostile block
 * value (written with the secret key) is served as the 404 page, and the editor shows the block
 * with the theme default and no script element.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const HOSTILE = "#FFF;}</style><script>window.__x=1</script>";
const publishButton = (page: Page) =>
  page.locator("main > header").getByRole("button", { name: "Publish", exact: true });

const header = (id: string, text: string, overrides?: Record<string, unknown>) => ({
  id,
  type: "header",
  visible: true,
  text,
  ...(overrides ? { overrides } : {}),
});

/** Appends `blocks` to the owner's draft with the publishable key and the owner's JWT. */
async function patchDraft(token: string, pageId: string, blocks: unknown[]): Promise<void> {
  const current = (await pageRow(pageId)).draft;
  const { data, error } = await userClient(token)
    .from("pages")
    .update({ draft: { ...current, blocks: [...current.blocks, ...blocks] } })
    .eq("id", pageId)
    .select("id");
  expect(error, "the database takes any draft").toBeNull();
  expect(data).toHaveLength(1);
}

async function liveLook(browser: Browser, handle: string, ids: string[]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(url(handle));
  await expect(page.locator("[data-page-root]")).toBeVisible();
  const look = await page.evaluate((blockIds) => {
    const root = document.querySelector("[data-page-root]")!;
    return {
      background: getComputedStyle(root).backgroundColor,
      fonts: blockIds.map((id) => {
        const el = document.querySelector(`[data-block-id="${id}"]`);
        return el ? getComputedStyle(el).fontFamily : null;
      }),
      styles: blockIds.map(
        (id) => document.querySelector(`[data-block-id="${id}"]`)?.getAttribute("style") ?? null,
      ),
      html: document.documentElement.outerHTML,
    };
  }, ids);
  await context.close();
  return look;
}

test.describe("M6-45 direct-API abuse of block overrides", () => {
  test("M6-45 a header with a font, a background and a color publishes only the color; the live font and page background are unchanged", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "security flow: one viewport");
    const owner = await signedInUser(context, { label: "bsa1" });
    const token = await accessToken(context);
    const baseline = await liveLook(browser, owner.handle, []);

    await patchDraft(token, owner.pageId, [
      header("hdr-hostile-0001", "Styled heading", {
        fontHeading: "Geist",
        bg: "#000000",
        text: COLOR,
      }),
      header("hdr-plain-00001", "Plain heading"),
    ]);
    // The database took the stray keys like any draft.
    const stored = (await pageRow(owner.pageId)).draft.blocks.find(
      (b) => b.id === "hdr-hostile-0001",
    ) as { overrides?: unknown };
    expect(stored.overrides).toEqual({ fontHeading: "Geist", bg: "#000000", text: COLOR });

    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });

    const published = (await pageRow(owner.pageId)).published as { blocks: Block[] };
    const kept = published.blocks.find((b) => b.id === "hdr-hostile-0001") as {
      overrides?: unknown;
    };
    expect(kept.overrides).toEqual({ text: COLOR });
    expect(JSON.stringify(published.blocks)).not.toContain("Geist");

    const live = await liveLook(browser, owner.handle, ["hdr-hostile-0001", "hdr-plain-00001"]);
    // The inline style on the heading is the color and nothing else; its font is its sibling's.
    expect(live.styles[0]).toBe(`--t-text:${COLOR}`);
    expect(live.styles[1]).toBeNull();
    expect(live.fonts[0]).toBe(live.fonts[1]);
    expect(live.fonts[0]).not.toMatch(/Geist/);
    // The page background is what it was.
    expect(live.background).toBe(baseline.background);
    expect(live.background).not.toBe("rgb(0, 0, 0)");
    expect(live.html).not.toContain("--t-bg:#000000");
  });

  test("M6-45 a bad value on an image, a divider or a grid makes Publish fail naming the block; pages.published is unchanged and nothing hostile is live; the editor shows the block with the theme default", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "security flow: one viewport");
    const owner = await signedInUser(context, { label: "bsa2" });
    const token = await accessToken(context);
    const picture = await uploadImage(context, await halves(40, 30));
    const before = await pageRow(owner.pageId);
    expect(before.published).not.toBeNull();

    const BAD = "bad-style-0001";
    const cases: {
      name: string;
      block: Record<string, unknown>;
      message: string;
      /** The control whose own message shows the sentence. */
      field: string;
    }[] = [
      {
        name: "an image with a corner radius of -5",
        block: {
          id: BAD,
          type: "image",
          visible: true,
          image: picture,
          alt: "A picture",
          url: "",
          overrides: { radius: -5 },
        },
        message: "Corner radius isn’t valid. Use 0 to 32, or reset it to the theme default.",
        field: "override-radius",
      },
      {
        name: "an image with a border thickness of 99",
        block: {
          id: BAD,
          type: "image",
          visible: true,
          image: picture,
          alt: "A picture",
          url: "",
          overrides: { borderWidth: 99 },
        },
        message: "Border thickness isn’t valid. Use 0 to 4, or reset it to the theme default.",
        field: "override-border-width",
      },
      {
        name: "a divider with a border color of 'red'",
        block: { id: BAD, type: "divider", visible: true, overrides: { border: "red" } },
        message: "Color isn’t a valid hex color. Use #RRGGBB, or reset it to the theme default.",
        field: "override-color",
      },
      {
        name: "a grid with markup in its text color",
        block: {
          id: BAD,
          type: "grid",
          visible: true,
          cells: [
            { id: "cell-bad-00001", title: "One", subtitle: "", url: "https://example.com/1" },
            { id: "cell-bad-00002", title: "Two", subtitle: "", url: "https://example.com/2" },
          ],
          overrides: { text: HOSTILE },
        },
        message: "Color isn’t a valid hex color. Use #RRGGBB, or reset it to the theme default.",
        field: "override-color",
      },
    ];

    for (const c of cases) {
      // Reset to the page's own draft, then write the bad block with the owner's JWT.
      await adminClient().from("pages").update({ draft: before.draft }).eq("id", owner.pageId);
      await patchDraft(token, owner.pageId, [c.block]);

      await openEditor(page);
      // The editor draws the block with the theme default: the bad value is left out, and no script.
      const preview = previewScreen(page);
      await expect(blockIn(preview, BAD), c.name).toHaveCount(1);
      expect(await blockIn(preview, BAD).getAttribute("style"), c.name).toBeNull();
      await expect(preview.locator("script"), c.name).toHaveCount(0);
      expect(await page.evaluate(() => (window as { __x?: number }).__x), c.name).toBeUndefined();

      await publishButton(page).click();
      const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
      await expect(alert, c.name).toBeVisible();
      await expect(alert, c.name).toContainText(c.message);
      await expect(alert, c.name).toContainText("Fix 1 block before publishing.");

      // pages.published and published_at are exactly what they were.
      const after = await pageRow(owner.pageId);
      expect(after.published, c.name).toEqual(before.published);
      expect(after.published_at, c.name).toBe(before.published_at);

      // The live page shows none of it.
      const html = (await tenantGet(owner.handle)).text;
      expect(html, c.name).not.toContain(BAD);
      expect(html, c.name).not.toContain("window.__x");
      expect(html, c.name).not.toContain("</style><script>");
    }
  });

  test("M6-45 a published row holding a hostile block value serves the 404 page, and an unknown key is stripped, never served", async () => {
    const user = await makeUser("bsa3");
    const handle = `zq-bsa3-${rand(5)}`;
    const good = publishDocOf([
      header("hdr-hostile-0001", "Styled heading") as unknown as Block,
      header("hdr-plain-00001", "Plain heading") as unknown as Block,
    ]);
    const withOverrides = (overrides: unknown) => ({
      ...good,
      blocks: good.blocks.map((block, index) => (index === 0 ? { ...block, overrides } : block)),
    });

    // Written with the secret key, before the first request (a tenant page is cached once rendered).
    const hostileHandles: string[] = [];
    for (const [i, overrides] of [
      { text: HOSTILE },
      { radius: -5 },
      { borderWidth: 99 },
      { border: "red" },
    ].entries()) {
      const hostileHandle = `${handle}-${i}`;
      hostileHandles.push(hostileHandle);
      const owner = i === 0 ? user : await makeUser(`bsa3${i}`);
      await insertPage(owner.id, hostileHandle, {
        published: withOverrides(overrides),
        published_at: new Date().toISOString(),
      });
    }
    for (const hostileHandle of hostileHandles) {
      const res = await tenantGet(hostileHandle);
      expect(res.status, hostileHandle).toBe(404);
      expect(res.text).not.toContain("window.__x");
      expect(res.text).not.toContain("Styled heading");
      expect(res.text).not.toContain("data-page-root");
    }

    // An unknown key beside a valid one is stripped by the schema: the page renders, with the color only.
    const strayHandle = `${handle}-stray`;
    const stray = await makeUser("bsa3s");
    await insertPage(stray.id, strayHandle, {
      published: withOverrides({ text: COLOR, fontHeading: "Geist", bg: "#000000" }),
      published_at: new Date().toISOString(),
    });
    const ok = await tenantGet(strayHandle);
    expect(ok.status).toBe(200);
    const headingTag = ok.text.match(/<h2[^>]*data-block-id="hdr-hostile-0001"[^>]*>/)![0];
    expect(headingTag).toContain(`--t-text:${COLOR}`);
    expect(headingTag).not.toMatch(/--t-font-heading|--t-bg|Geist/);
  });
});
