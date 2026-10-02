import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rendererFixtureDoc } from "@/components/page/fixture-doc";
import { TOKEN_KEYS, tokenCssVarName } from "@/lib/theme";
import type { Block } from "@/lib/document";
import {
  addBlock,
  box,
  css,
  draftOf,
  openEditor,
  previewScreen,
  publishDocOf,
  publishedPage,
  showView,
  uploadImage,
  userWithDraft,
} from "./blocks-helpers";

/**
 * M2-05: the shared renderer on the live page (and in the editor preview). The stress checks run on
 * a page published with the renderer's fixture document, and again on /dev/renderer, the dev-only
 * route that serves the same document.
 */

test.afterAll(cleanupUsers);

const id = (n: number) => `blk-test-${String(n).padStart(4, "0")}`;

/** One block of every type, enough to check order, ids and attributes. */
const ALL_BLOCKS: Block[] = [
  {
    id: id(1),
    type: "social",
    visible: true,
    icons: [
      { id: "ico-test-0001", platform: "instagram", url: "https://instagram.com/mara" },
      { id: "ico-test-0002", platform: "email", address: "hello@maraokafor.example" },
    ],
  },
  { id: id(2), type: "header", visible: true, text: "Book a session" },
  {
    id: id(3),
    type: "link",
    visible: true,
    label: "Portrait sessions",
    url: "https://maraokafor.example/book",
  },
  {
    id: id(4),
    type: "card",
    visible: true,
    title: "Night Market",
    caption: "",
    url: "https://maraokafor.example/night-market",
    image: null,
  },
  {
    id: id(5),
    type: "embed",
    visible: true,
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    caption: "Ep. 4",
  },
  {
    id: id(6),
    type: "grid",
    visible: true,
    cells: [
      {
        id: "cel-test-0001",
        title: "Prints",
        subtitle: "Shop",
        url: "https://maraokafor.example/prints",
      },
      {
        id: "cel-test-0002",
        title: "Workshops",
        subtitle: "",
        url: "https://maraokafor.example/workshops",
      },
    ],
  },
  { id: id(7), type: "divider", visible: true },
  { id: id(8), type: "text", visible: true, text: "Line one\nLine two" },
];

/** Collects dialogs (alert, confirm, prompt) fired by the page. */
function trackDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  return dialogs;
}

async function expectStressLayout(page: Page, projectName: string): Promise<void> {
  const root = page.locator("[data-page-root]");
  await expect(root).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Avatar: 96px circle; the name wraps instead of overflowing.
  const avatar = await box(page.locator(".pg-avatar"));
  expect(avatar.width).toBe(96);
  expect(avatar.height).toBe(96);
  expect(await css(page.locator(".pg-avatar"), "border-top-left-radius")).toBe("50%");
  const name = page.getByRole("heading", { level: 1 });
  expect(await css(name, "overflow-wrap")).toBe("anywhere");
  const fits = await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  const lineCount = await name.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
  );
  expect(lineCount).toBeGreaterThan(1);

  // Every anchor, button and social icon is at least 44px tall.
  await expectTapTargets(page, "[data-page-root]");
  for (const handle of await page.locator("[data-page-root] a, [data-page-root] button").all()) {
    expect((await box(handle)).height).toBeGreaterThanOrEqual(43.5);
  }

  const column = await box(page.locator("main"));
  const viewport = page.viewportSize()!;
  if (projectName === "desktop") {
    expect(column.width).toBeLessThanOrEqual(480);
    expect(Math.abs(column.x + column.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
    const rootBox = await box(root);
    expect(rootBox.x).toBe(0);
    expect(rootBox.width).toBe(viewport.width);
    expect(rootBox.height).toBeGreaterThanOrEqual(viewport.height);
    expect(await css(root, "background-color")).toBe("rgb(247, 247, 245)");
  }
}

test.describe("M2-05 the shared page renderer", () => {
  test("M2-05 the root carries every token as a --t- variable and is a size container", async ({
    page,
  }) => {
    const live = await publishedPage("rt", publishDocOf(ALL_BLOCKS));
    await page.goto(live.url);
    const root = page.locator("[data-page-root]");
    const vars = await root.evaluate(
      (el, names) => names.map((name) => [name, (el as HTMLElement).style.getPropertyValue(name)]),
      TOKEN_KEYS.map(tokenCssVarName),
    );
    for (const [name, value] of vars) expect(value, name).not.toBe("");
    expect(await css(root, "container-type")).toBe("inline-size");
    expect(await css(root, "background-color")).toBe("rgb(247, 247, 245)");
    // The page styles never read a HYDLNK variable.
    const html = await page.content();
    expect(html).not.toContain("--hl-");
  });

  test("M2-05 profile and blocks: h1, bio, blocks in order inside <main> with id and type", async ({
    page,
  }) => {
    const live = await publishedPage(
      "rp",
      publishDocOf(ALL_BLOCKS, { name: "Mara Okafor", bio: "Portrait photographer" }),
    );
    await page.goto(live.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mara Okafor");
    await expect(page.locator(".pg-bio")).toHaveText("Portrait photographer");
    await expect(page.locator(".pg-avatar")).toHaveText("MO");
    const blocks = page.locator("main > [data-block-id]");
    await expect(blocks).toHaveCount(ALL_BLOCKS.length);
    expect(
      await blocks.evaluateAll((els) => els.map((el) => el.getAttribute("data-block-type"))),
    ).toEqual(ALL_BLOCKS.map((block) => block.type));
    expect(
      await blocks.evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id"))),
    ).toEqual(ALL_BLOCKS.map((block) => block.id));
    await expect(page.locator("[data-block-type=social] [data-item-id]")).toHaveCount(2);
    await expect(page.locator("[data-block-type=grid] [data-item-id]")).toHaveCount(2);
    await expect(page.locator("main")).toHaveCount(1);
  });

  test("M2-05 an empty name and bio render no empty element, and the avatar shows '?' (editor preview)", async ({
    page,
    context,
  }) => {
    // An empty name cannot be published, so the live page never shows one; the preview can.
    await userWithDraft(context, "re", (handle) =>
      draftOf(handle, [], { profile: { name: "", bio: "", photo: null } }),
    );
    await openEditor(page);
    await showView(page, "Preview");
    const screen = previewScreen(page);
    await expect(screen.locator(".pg-avatar")).toHaveText("?");
    await expect(screen.locator("h1")).toHaveCount(0);
    await expect(screen.locator(".pg-bio")).toHaveCount(0);
  });

  test("M2-05 a hostile name renders as visible text and fires no dialog", async ({ page }) => {
    const dialogs = trackDialogs(page);
    const evil = "<img src=x onerror=alert(1)>";
    const live = await publishedPage("rx", publishDocOf(ALL_BLOCKS, { name: evil, bio: evil }));
    await page.goto(live.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(evil);
    await expect(page.locator(".pg-bio")).toHaveText(evil);
    await expect(page.locator("[data-page-root] img")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);
  });

  test("M2-05 the avatar shows the photo, with the display name as alt, and the page stays a circle", async ({
    page,
  }) => {
    const owner = await publishedPage("rph0", publishDocOf([]));
    const photo = await uploadImage(owner.userId, 200, 100);
    const live = await publishedPage("rph", publishDocOf([], { name: "Mara Okafor", photo }));
    // The photo lives in the first user's folder: the renderer only builds the URL from the path.
    await page.goto(live.url);
    const img = page.locator(".pg-avatar img");
    await expect(img).toHaveAttribute("alt", "Mara Okafor");
    await expect(img).toHaveAttribute(
      "src",
      new RegExp(`/storage/v1/object/public/page-media/${photo.path}$`),
    );
    expect(await css(img, "object-fit")).toBe("cover");
    const avatar = await box(page.locator(".pg-avatar"));
    expect(avatar.width).toBe(96);
    expect(avatar.height).toBe(96);
    await expect(img).toHaveJSProperty("complete", true);
    expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(200);
  });

  test("M2-05 outbound anchors have rel nofollow noopener and an http(s) href", async ({
    page,
  }) => {
    const live = await publishedPage("ro", publishDocOf(ALL_BLOCKS));
    await page.goto(live.url);
    const anchors = page.locator("main a");
    expect(await anchors.count()).toBeGreaterThanOrEqual(6);
    const attrs = await anchors.evaluateAll((els) =>
      els.map((el) => [el.getAttribute("href"), el.getAttribute("rel")]),
    );
    for (const [href, rel] of attrs) {
      expect(rel).toBe("nofollow noopener");
      expect(href).toMatch(/^(https?:\/\/|mailto:)/);
    }
  });

  test("M2-05 axe finds no serious or critical violations on a page with every block type", async ({
    page,
  }) => {
    await page.route(/youtube/, (route) => route.abort());
    const live = await publishedPage(
      "ra",
      publishDocOf(ALL_BLOCKS, { name: "Mara Okafor", bio: "Photographer" }),
    );
    await page.goto(live.url);
    await expect(page.locator("[data-page-root]")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M2-05 the stress page holds at this viewport (name, bio, links, grid, text, icons)", async ({
    page,
  }, testInfo) => {
    const live = await publishedPage("rs", rendererFixtureDoc());
    await page.goto(live.url);
    await expectStressLayout(page, testInfo.project.name);
  });

  test("M2-05 the column is centered and no wider than 480px, the background fills the viewport (1440x900)", async ({
    page,
  }, testInfo) => {
    test.skip(!desktopOnly(testInfo), "desktop layout check");
    const live = await publishedPage("rd", publishDocOf(ALL_BLOCKS));
    await page.goto(live.url);
    const root = await box(page.locator("[data-page-root]"));
    expect(root).toMatchObject({ x: 0, y: 0, width: 1440 });
    expect(root.height).toBeGreaterThanOrEqual(900);
    const column = await box(page.locator(".pg-column"));
    expect(column.width).toBeLessThanOrEqual(480);
    expect(Math.abs(column.x + column.width / 2 - 720)).toBeLessThanOrEqual(1);
    await expectNoHorizontalScroll(page);
  });

  test("M2-05 at 390px the avatar is 96px and every control is 44px", async ({
    page,
  }, testInfo) => {
    test.skip(!phoneOnly(testInfo), "phone layout check");
    const live = await publishedPage("rm", publishDocOf(ALL_BLOCKS));
    await page.goto(live.url);
    expect((await box(page.locator(".pg-avatar"))).width).toBe(96);
    await expectTapTargets(page, "[data-page-root]");
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M2-05 the dev-only fixture route /dev/renderer", () => {
  test("M2-05 /dev/renderer serves the stress page and holds at this viewport", async ({
    page,
  }, testInfo) => {
    const response = await page.goto(url(undefined, "/dev/renderer"));
    expect(response?.status(), "needs src/app/(marketing)/dev/renderer/page.tsx").toBe(200);
    await expectStressLayout(page, testInfo.project.name);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Abcdefghij".repeat(6));
  });
});

test.describe("M2-05 the editor preview uses the same renderer", () => {
  test("M2-05 clicking a link or social icon in the preview does not navigate", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "rv");
    await openEditor(page);
    const link = await addBlock(page, "link");
    await link.panel.getByLabel("Link", { exact: true }).fill("https://example.com/away");
    const social = await addBlock(page, "social");
    await social.panel
      .getByRole("group")
      .first()
      .getByLabel("Link", { exact: true })
      .fill("https://instagram.com/away");
    await showView(page, "Preview");
    const before = page.url();
    await previewScreen(page).locator(`a[data-block-id="${link.id}"]`).click();
    await previewScreen(page).locator(`[data-block-id="${social.id}"] a`).first().click();
    await page.waitForTimeout(300);
    expect(page.url()).toBe(before);
    // The renderer's root is the preview's root too, with the draft's resolved background.
    const root = previewScreen(page).locator("[data-page-root]");
    await expect(root).toHaveCount(1);
    expect(await css(root, "background-color")).toBe("rgb(247, 247, 245)");
  });
});
