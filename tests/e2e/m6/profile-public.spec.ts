import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, insertPage, makeUser, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { uploadImage } from "../m2/blocks-helpers";
import { publishedDocSchema, type Block, type PublishDoc } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, resolveTokens, type TokenOverrides } from "@/lib/theme";

/**
 * M6-15 (photo shape, size, border, show photo) and M6-17 (hide the name and the bio) on the public
 * page: one component draws it, so what these check on http://<handle>.localhost:3000 is what the
 * editor preview draws too. Each test publishes its own page with the secret key and reads it
 * back as a visitor.
 */

test.afterAll(cleanupUsers);

const BLOCKS: Block[] = [
  { id: "hdr-prof-0001", type: "header", visible: true, text: "Book a session" },
  {
    id: "lnk-prof-0001",
    type: "link",
    visible: true,
    label: "Portraits",
    url: "https://example.com/a",
  },
  {
    id: "lnk-prof-0002",
    type: "link",
    visible: true,
    label: "Weddings",
    url: "https://example.com/b",
  },
  {
    id: "lnk-prof-0003",
    type: "link",
    visible: true,
    label: "Prints",
    url: "https://example.com/c",
  },
  { id: "txt-prof-0001", type: "text", visible: true, text: "Based in Orlando." },
];

interface Live {
  userId: string;
  handle: string;
  url: string;
  doc: unknown;
}

/** A page that is live with this profile (and, optionally, a real uploaded photo). */
async function livePage(
  label: string,
  profile: Record<string, unknown> = {},
  opts: { photo?: boolean; tokens?: TokenOverrides; blocks?: Block[]; strip?: boolean } = {},
): Promise<Live> {
  const user = await makeUser(label);
  const handle = `zq-${label}-${rand(5)}`;
  const photo = opts.photo ? await uploadImage(user.id, 64, 64) : null;
  const parsed: PublishDoc = publishedDocSchema.parse({
    version: 1,
    profile: { name: "Mara Okafor", bio: "Photographer in Orlando", photo, ...profile },
    theme: { ref: null, overrides: opts.tokens ?? {} },
    tokens: resolveTokens(null, opts.tokens),
    blocks: opts.blocks ?? BLOCKS,
  });
  // A page stored before M6 has none of the six options: take them out of the parsed copy.
  let doc: unknown = parsed;
  if (opts.strip) {
    const { profile: p, ...rest } = parsed;
    doc = { ...rest, profile: { name: p.name, bio: p.bio, photo: p.photo } };
  }
  await insertPage(user.id, handle, { published: doc, published_at: new Date().toISOString() });
  return { userId: user.id, handle, url: url(handle), doc };
}

const css = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

const hexToRgb = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** The page is as wide as the viewport and the background token fills it. */
async function expectBackgroundCovers(page: Page): Promise<void> {
  const view = page.viewportSize()!;
  const root = page.locator("[data-page-root]");
  const box = (await root.boundingBox())!;
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.width).toBeCloseTo(view.width, 0);
  expect(box.height).toBeGreaterThanOrEqual(view.height - 1);
  expect(await root.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    hexToRgb(SYSTEM_DEFAULT_TOKENS.bg),
  );
}

test.describe("M6-15 photo options on the public page", () => {
  test("M6-15 a page stored before the options draws the same avatar as always: 96px circle, page border", async ({
    page,
  }) => {
    const live = await livePage("po1", {}, { strip: true });
    expect(live.doc).toHaveProperty("profile");
    expect(Object.keys((live.doc as { profile: object }).profile)).toEqual([
      "name",
      "bio",
      "photo",
    ]);
    await page.goto(live.url);
    const avatar = page.locator(".pg-avatar");
    await expect(avatar).toHaveAttribute("data-shape", "circle");
    await expect(avatar).toHaveAttribute("data-size", "medium");
    await expect(avatar).toHaveAttribute("data-border", "page");
    await expect(avatar).toHaveText("MO");
    const box = (await avatar.boundingBox())!;
    expect([box.width, box.height]).toEqual([96, 96]);
    expect(await css(page, ".pg-avatar", "border-top-left-radius")).toBe("50%");
    expect(await css(page, ".pg-avatar", "border-top-width")).toBe(
      `${SYSTEM_DEFAULT_TOKENS.borderWidth}px`,
    );
    expect(await css(page, ".pg-avatar", "border-top-color")).toBe(
      hexToRgb(SYSTEM_DEFAULT_TOKENS.accent),
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mara Okafor");
  });

  for (const [shape, radius] of [
    ["circle", "50%"],
    ["rounded", "24%"],
    ["square", "0px"],
  ] as const) {
    test(`M6-15 ${shape} photo: the photo and the initials are both clipped by the shape`, async ({
      page,
    }) => {
      const withPhoto = await livePage(`pos-${shape}`, { photoShape: shape }, { photo: true });
      await page.goto(withPhoto.url);
      const avatar = page.locator(".pg-avatar");
      await expect(avatar).toHaveAttribute("data-shape", shape);
      expect(await css(page, ".pg-avatar", "overflow")).toBe("hidden");
      const px = await css(page, ".pg-avatar", "border-top-left-radius");
      expect(px).toBe(radius);
      await expect(avatar.locator("img")).toHaveAttribute("alt", "Mara Okafor");

      const initials = await livePage(`poi-${shape}`, { photoShape: shape });
      await page.goto(initials.url);
      await expect(page.locator(".pg-avatar")).toHaveText("MO");
      expect(await css(page, ".pg-avatar", "overflow")).toBe("hidden");
      expect(await css(page, ".pg-avatar", "border-top-left-radius")).toBe(px);
    });
  }

  for (const [size, px] of [
    ["small", 64],
    ["medium", 96],
    ["large", 144],
  ] as const) {
    test(`M6-15 ${size} photo is ${px}px`, async ({ page }) => {
      const live = await livePage(`pz-${size}`, { photoSize: size });
      await page.goto(live.url);
      const box = (await page.locator(".pg-avatar").boundingBox())!;
      expect([box.width, box.height]).toEqual([px, px]);
    });
  }

  for (const [border, width] of [
    ["none", "0px"],
    ["thin", "2px"],
    ["thick", "4px"],
    ["page", `${SYSTEM_DEFAULT_TOKENS.borderWidth}px`],
  ] as const) {
    test(`M6-15 ${border} border is ${width} in the accent color`, async ({ page }) => {
      const live = await livePage(`pb-${border}`, { photoBorder: border });
      await page.goto(live.url);
      expect(await css(page, ".pg-avatar", "border-top-width")).toBe(width);
      if (width !== "0px") {
        expect(await css(page, ".pg-avatar", "border-top-color")).toBe(
          hexToRgb(SYSTEM_DEFAULT_TOKENS.accent),
        );
      }
    });
  }

  test("M6-15 a narrow container steps the sizes down: 48px, 64px and 96px", async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "phone",
      "the narrow rule is checked once, on the phone project",
    );
    const live = await livePage("pn", {});
    await page.goto(live.url);
    // A 300px frame is a narrower container than any real phone (the editor's bezel is 310px).
    const sizes = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-page-root]")!;
      const out: Record<string, number> = {};
      root.style.width = "300px";
      for (const size of ["small", "medium", "large"]) {
        const avatar = document.querySelector<HTMLElement>(".pg-avatar")!;
        avatar.setAttribute("data-size", size);
        out[size] = avatar.getBoundingClientRect().width;
      }
      return out;
    });
    expect(sizes).toEqual({ small: 48, medium: 64, large: 96 });
  });

  test("M6-15 show photo off draws no avatar element, not even the initials, and the name moves up", async ({
    page,
  }) => {
    const live = await livePage("ps", { showPhoto: false }, { photo: true });
    await page.goto(live.url);
    await expect(page.locator(".pg-avatar")).toHaveCount(0);
    await expect(page.locator(".pg-profile img")).toHaveCount(0);
    await expect(page.locator(".pg-profile")).not.toContainText("MO");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mara Okafor");
    // The name is the first thing in the header: no gap left for a missing photo.
    const header = (await page.locator(".pg-profile").boundingBox())!;
    const name = (await page.locator(".pg-name").boundingBox())!;
    expect(name.y - header.y).toBeLessThanOrEqual(1);
  });

  test("M6-15 a square, thick, large photo fits the column at every width", async ({
    page,
  }, info) => {
    const live = await livePage(
      "pl",
      {
        photoShape: "square",
        photoSize: "large",
        photoBorder: "thick",
        name: "<img src=x onerror=alert(1)>",
      },
      { photo: true },
    );
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(live.url);
    const avatar = page.locator(".pg-avatar");
    const box = (await avatar.boundingBox())!;
    const column = (await page.locator(".pg-column").boundingBox())!;
    expect([box.width, box.height]).toEqual([144, 144]);
    expect(box.width).toBeLessThanOrEqual(column.width - 48 + 0.5);
    expect(await css(page, ".pg-avatar", "border-top-width")).toBe("4px");
    expect(await css(page, ".pg-avatar", "border-top-left-radius")).toBe("0px");
    // The name is text beside the avatar.
    await expect(page.locator(".pg-name")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(page.locator(".pg-name img")).toHaveCount(0);
    expect(dialogs).toEqual([]);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    if (info.project.name === "desktop") {
      expect(column.width).toBeLessThanOrEqual(480);
      // Centered in the column.
      expect(box.x + box.width / 2).toBeCloseTo(column.x + column.width / 2, 0);
    }
    await expectBackgroundCovers(page);
  });

  test("M6-15 left-aligned pages keep the large avatar at the left of the column", async ({
    page,
  }) => {
    const live = await livePage("pla", { photoSize: "large" }, { tokens: { align: "left" } });
    await page.goto(live.url);
    const box = (await page.locator(".pg-avatar").boundingBox())!;
    const column = (await page.locator(".pg-column").boundingBox())!;
    expect(box.x).toBeCloseTo(column.x + 24, 0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M6-17 hide the name and the bio", () => {
  test("M6-17 a hidden name stays the page's one h1, clipped, and the title and sharing tags keep it", async ({
    page,
  }) => {
    const live = await livePage("hn", { showName: false }, { photo: true });
    await page.goto(live.url);

    const headings = page.getByRole("heading", { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText("Mara Okafor");
    const hidden = page.locator("h1.pg-name");
    const style = await hidden.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        position: s.position,
        width: s.width,
        height: s.height,
        overflow: s.overflow,
        display: s.display,
        visibility: s.visibility,
        clipPath: s.clipPath,
      };
    });
    expect(style).toMatchObject({
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      visibility: "visible",
    });
    expect(style.display).not.toBe("none");
    expect(style.clipPath).not.toBe("none");
    // No visible name: a 1px box, outside the flow, and no tap target.
    await expect(hidden).not.toHaveAttribute("data-profile-part", /.*/);

    await expect(page).toHaveTitle("Mara Okafor - links");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Photographer in Orlando",
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "Mara Okafor",
    );
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      "content",
      "Photographer in Orlando",
    );
    // The photo's alt is still the name; the bio is still drawn.
    await expect(page.locator(".pg-avatar img")).toHaveAttribute("alt", "Mara Okafor");
    await expect(page.locator(".pg-bio")).toHaveText("Photographer in Orlando");
  });

  test("M6-17 a hidden bio draws no bio element but is still the meta description", async ({
    page,
  }) => {
    const live = await livePage("hb", { showBio: false });
    await page.goto(live.url);
    await expect(page.locator(".pg-bio")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Photographer in Orlando");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Photographer in Orlando",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mara Okafor");
  });

  test("M6-17 photo, name and bio hidden: the page starts with the first block", async ({
    page,
  }, info) => {
    const live = await livePage("ha", { showPhoto: false, showName: false, showBio: false });
    await page.goto(live.url);
    await expect(page.locator(".pg-profile")).toHaveCount(0);
    await expect(page.locator(".pg-avatar")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const gap = await page.evaluate(() => {
      const column = document.querySelector<HTMLElement>(".pg-column")!;
      const first = document.querySelector<HTMLElement>(".pg-blocks > *")!;
      const padding = Number.parseFloat(getComputedStyle(column).paddingTop);
      return first.getBoundingClientRect().top - column.getBoundingClientRect().top - padding;
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    await expect(page.locator(".pg-blocks > *")).toHaveCount(BLOCKS.length);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    if (info.project.name === "desktop") {
      const column = (await page.locator(".pg-column").boundingBox())!;
      expect(column.width).toBeLessThanOrEqual(480);
      expect(column.x + column.width / 2).toBeCloseTo(page.viewportSize()!.width / 2, 0);
    }
    await expectBackgroundCovers(page);
  });

  test("M6-17 the share image still draws for a page with the name and bio hidden", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "one request is enough");
    const live = await livePage("ho", { showName: false, showBio: false, showPhoto: false });
    const response = await page.request.get(`${live.url}og`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  });

  test("M6-17 the hidden name does not add a gap when only the bio shows", async ({ page }) => {
    const live = await livePage("hg", { showPhoto: false, showName: false });
    await page.goto(live.url);
    const header = (await page.locator(".pg-profile").boundingBox())!;
    const bio = (await page.locator(".pg-bio").boundingBox())!;
    const column = (await page.locator(".pg-column").boundingBox())!;
    expect(Math.abs(bio.y - (column.y + 56))).toBeLessThanOrEqual(1);
    expect(Math.abs(header.y - bio.y)).toBeLessThanOrEqual(1);
  });

  test("M6-17 a script in a hidden name and bio never runs and the description is escaped", async ({
    page,
  }) => {
    const script = "<script>alert(1)</script>";
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const live = await livePage("hx", {
      name: script,
      bio: script,
      showName: false,
      showBio: false,
    });
    await page.goto(live.url);
    await expect(page.locator("h1.pg-name")).toHaveText(script);
    await expect(page.locator("h1.pg-name script")).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", script);
    await expect(page).toHaveTitle(`${script} - links`);
    const html = await (await page.request.get(live.url)).text();
    expect(html).not.toContain(`<meta name="description" content="<script>`);
    expect(html).toMatch(/content="&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
    expect(dialogs).toEqual([]);
  });
});
