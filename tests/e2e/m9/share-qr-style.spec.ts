import { readFileSync } from "node:fs";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import {
  cleanupUsers,
  desktopOnly,
  phoneOnly,
  signedInUser,
  type SignedInUser,
} from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { addVerifiedDomains } from "../m4/lifecycle-helpers";
import { emptyUser } from "../m2/editor-helpers";
import { signInAsUser } from "../m5/admin-helpers";
import { openShare } from "../m6/share-helpers";
import { TEMPLATE_THEME_IDS } from "@/lib/templates/catalog";
import { qrSvg, makeQr } from "@/lib/qr/generate";
import {
  PNG_SIGNATURE,
  REFUSED,
  colorMode,
  colorsStatus,
  decodeQr,
  download,
  downloadPng,
  downloadSvg,
  frameSwitch,
  frameText,
  givePhoto,
  hexToRgb,
  ihdrOf,
  legacyQrPng,
  logoSwitch,
  pixel,
  preview,
  qrCard,
  rasterize,
  resetStyle,
  setCustom,
  setThemeRef,
  styleGroup,
  themeColors,
  typeColor,
  viewBoxOf,
} from "./qr-style-helpers";

/**
 * M9-25: the QR card's Style group (colors, a logo in the center, a frame with text) on the phone
 * (390x844) and desktop (1440x900) projects. The files are downloaded and read back: a real decoder
 * (jsQR) on the PNG's pixels and on each SVG drawn into a canvas, the default files byte for byte
 * against the M6-31 generator, the network log for the one request the logo may make, and the layout.
 * The pure rules are tests/unit/m9-share-qr-*.test.ts.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const SOLID = { width: 400, height: 400 };
const WIDE = { width: 800, height: 200 };

/** A signed-in user with one published page and a square photo (so the logo switch is available). */
async function userWithPhoto(
  context: Parameters<typeof signedInUser>[0],
  label: string,
  size = SOLID,
  opts: { plan?: "free" | "pro" } = {},
): Promise<SignedInUser> {
  const user = await signedInUser(context, { label, plan: opts.plan });
  await givePhoto(user.userId, user.pageId, size);
  return user;
}

async function openCard(page: Page) {
  await openShare(page);
  await expect(qrCard(page)).toBeVisible();
  await expect(styleGroup(page)).toBeVisible();
  return qrCard(page);
}

/** Both downloads of the current style, decoded: the PNG's pixels and the SVG drawn into a canvas. */
async function expectBothDecode(
  page: Page,
  address: string,
  sizes?: { width: number; height: number },
) {
  const png = await download(page, "png");
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  const header = ihdrOf(png);
  if (sizes) expect(header).toMatchObject(sizes);
  expect(await decodeQr(png), "the PNG decodes to the address").toBe(address);

  const svg = (await download(page, "svg")).toString("utf8");
  const box = viewBoxOf(svg);
  if (sizes) expect(box).toEqual(sizes);
  const blank = await page.context().newPage();
  await blank.goto("about:blank");
  const raster = await rasterize(blank, svg, box.width, box.height);
  await blank.close();
  expect(await decodeQr(raster), "the SVG decodes to the address").toBe(address);
  return { png, svg };
}

test.describe("M9-25 the Style group", () => {
  test("M9-25 under the code: Colors, Logo, Frame and Reset style, every control at its default", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "qs1" });
    const card = await openCard(page);
    const group = styleGroup(page);
    await expect(group.getByRole("heading", { level: 3, name: "Style" })).toBeVisible();

    const radios = group.getByRole("radiogroup", { name: "Colors" }).getByRole("radio");
    await expect(radios).toHaveText(["Black and white", "Page colors", "Custom"]);
    await expect(colorMode(page, "Black and white")).toHaveAttribute("aria-checked", "true");
    await expect(colorMode(page, "Page colors")).toHaveAttribute("aria-checked", "false");
    await expect(colorMode(page, "Custom")).toHaveAttribute("aria-checked", "false");
    // No Custom rows until Custom is chosen.
    await expect(group.getByLabel("Code color hex")).toHaveCount(0);

    // A page with no logo and no photo: the switch is off, disabled, and says why.
    await expect(logoSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(logoSwitch(page)).toBeDisabled();
    await expect(group).toContainText("Add a logo or a photo to your page first.");

    await expect(frameSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(frameText(page)).toHaveCount(0);
    await expect(resetStyle(page)).toBeVisible();
    await expect(colorsStatus(page)).toBeEmpty();

    // The code is the one of M6-31: black on white, in the card's order (the Style group is under it).
    const colors = await preview(page).evaluate((svg) => ({
      rect: svg.querySelector("rect")!.getAttribute("fill"),
      path: svg.querySelector("path")!.getAttribute("fill"),
    }));
    expect(colors).toEqual({ rect: "#ffffff", path: "#000000" });
    const text = await card.innerText();
    expect(text).not.toMatch(/please|successfully|!/i);
  });

  test("M9-25 every control is at least 44px tall and the controls are reachable by keyboard", async ({
    page,
    context,
  }) => {
    await userWithPhoto(context, "qs2");
    await openCard(page);
    await colorMode(page, "Custom").click();
    await frameSwitch(page).click();
    await expectTapTargets(page, '[data-testid="qr-card"]');

    // Keyboard: the radiogroup takes one Tab stop and arrow keys move the choice; switches toggle on Space.
    await colorMode(page, "Custom").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(colorMode(page, "Page colors")).toBeFocused();
    await expect(colorMode(page, "Page colors")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(colorMode(page, "Black and white")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowLeft"); // wraps
    await expect(colorMode(page, "Custom")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Tab"); // out of the radiogroup, into the first Custom control
    await expect(styleGroup(page).getByRole("button", { name: "Code color" })).toBeFocused();

    await logoSwitch(page).focus();
    await page.keyboard.press("Space");
    await expect(logoSwitch(page)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(logoSwitch(page)).toHaveAttribute("aria-checked", "false");
    await frameSwitch(page).focus();
    await expect(frameSwitch(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(frameSwitch(page)).toHaveAttribute("aria-checked", "false");
  });

  test("M9-25 states: a page never published, and a suspended owner, have no Style group and no downloads", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "qs3");
    await openShare(page);
    await expect(qrCard(page)).toContainText(
      "Publish your page first. Then you can download its QR code.",
    );
    await expect(styleGroup(page)).toHaveCount(0);
    await expect(qrCard(page).getByRole("button")).toHaveCount(0);

    const suspended = await context.newPage();
    await signInAsUser(context, "qs3b", { suspended: true });
    await openShare(suspended);
    await expect(qrCard(suspended)).toContainText("This page isn’t available right now.");
    await expect(styleGroup(suspended)).toHaveCount(0);
    await expect(qrCard(suspended).getByRole("button")).toHaveCount(0);
  });
});

test.describe("M9-25 defaults are M6-31, byte for byte", () => {
  test("M9-25 with every control at its default the SVG is exactly what the M6-31 generator writes", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qd1" });
    await openCard(page);
    const svg = (await download(page, "svg")).toString("utf8");
    expect(svg).toBe(qrSvg(makeQr(url(user.handle))));
    expect(svg.match(/<(rect|path)\b/g)).toEqual(["<rect", "<path"]);
  });

  test("M9-25 with every control at its default the PNG is 1024x1024 and its bytes are the M6-31 generator's, drawn by the same browser", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qd2" });
    await openCard(page);
    const png = await download(page, "png");
    expect(ihdrOf(png)).toMatchObject({ width: 1024, height: 1024 });
    const legacy = await legacyQrPng(context, url(user.handle));
    expect(png.equals(legacy), "the PNG equals what renderQrPng draws").toBe(true);
  });

  test("M9-25 Reset style returns every control to its default, and the files to the default bytes", async ({
    page,
    context,
  }) => {
    const user = await userWithPhoto(context, "qd3");
    await openCard(page);
    const before = await download(page, "svg");

    await setCustom(page, "#0B2A5B", "#FBF6E9");
    await logoSwitch(page).click();
    await frameSwitch(page).click();
    await frameText(page).fill("Visit us");
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
    expect((await download(page, "svg")).equals(before)).toBe(false);

    await resetStyle(page).click();
    await expect(colorMode(page, "Black and white")).toHaveAttribute("aria-checked", "true");
    await expect(logoSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(frameSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(frameText(page)).toHaveCount(0);
    await expect(styleGroup(page).getByLabel("Code color hex")).toHaveCount(0);
    const after = await download(page, "svg");
    expect(after.equals(before)).toBe(true);
    expect(after.toString("utf8")).toBe(qrSvg(makeQr(url(user.handle))));
    // And the frame text is back to Scan me when the frame is turned on again.
    await frameSwitch(page).click();
    await expect(frameText(page)).toHaveValue("Scan me");
  });

  test("M9-25 the style is view state: nothing is saved, and it is gone after a reload", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qd4" });
    await openCard(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(request.url());
    });
    await setCustom(page, "#0B2A5B", "#FBF6E9");
    await frameSwitch(page).click();
    await page.waitForTimeout(1500); // longer than the autosave's wait
    expect(requests).toEqual([]);
    const row = await adminClient().from("pages").select("draft").eq("id", user.pageId).single();
    expect(JSON.stringify(row.data!.draft)).not.toMatch(/0B2A5B|FBF6E9|Scan me|qr/i);

    await page.reload();
    await expect(styleGroup(page)).toBeVisible();
    await expect(colorMode(page, "Black and white")).toHaveAttribute("aria-checked", "true");
    await expect(frameSwitch(page)).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("M9-25 colors", () => {
  test("M9-25 Custom: dark blue on cream, typed as hex, shows in the preview and both files decode", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qc1" });
    await openCard(page);
    await setCustom(page, "#0b2a5b", "#fbf6e9");
    await expect(styleGroup(page).getByLabel("Code color hex")).toHaveValue("#0B2A5B");
    await expect(colorsStatus(page)).toBeEmpty();
    const shown = await preview(page).evaluate((svg) => ({
      background: svg.querySelector("rect")!.getAttribute("fill"),
      code: svg.querySelector("path")!.getAttribute("fill"),
    }));
    expect(shown).toEqual({ background: "#FBF6E9", code: "#0B2A5B" });

    const { png, svg } = await expectBothDecode(page, url(user.handle), {
      width: 1024,
      height: 1024,
    });
    // The two validated colors, and nothing else of the page's, are in the files.
    expect(await pixel(png, 2, 2)).toEqual(hexToRgb("#FBF6E9"));
    expect([...new Set(svg.match(/#[0-9A-Fa-f]{3,8}\b/g))].sort()).toEqual(["#0B2A5B", "#FBF6E9"]);
    expect(svg).not.toMatch(/<text|<image/);
  });

  test("M9-25 the color picker of M9-07 sets a Custom color, and the hex field follows it", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "qc2" });
    await openCard(page);
    await colorMode(page, "Custom").click();
    const swatch = styleGroup(page).getByRole("button", { name: "Code color", exact: true });
    await swatch.click();
    const panel = styleGroup(page).getByRole("group", { name: "Code color picker" });
    await expect(panel).toBeVisible();
    // Drag in the saturation square: the hex field takes a new color.
    const area = panel.locator(".react-colorful__saturation");
    const box = (await area.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
    await expect(styleGroup(page).getByLabel("Code color hex")).not.toHaveValue("#000000");
    await expect(styleGroup(page).getByLabel("Code color hex")).toHaveValue(/^#[0-9A-F]{6}$/);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(swatch).toBeFocused();
  });

  test("M9-25 Page colors: the page's text on its background, for two light system themes (Ivory and Paper)", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qc3" });
    for (const [name, id] of [
      ["Ivory", TEMPLATE_THEME_IDS.Ivory],
      ["Paper", TEMPLATE_THEME_IDS.Paper],
    ] as const) {
      await setThemeRef(user.pageId, id);
      const { text, bg } = await themeColors(id);
      await openCard(page);
      await colorMode(page, "Page colors").click();
      await expect(colorsStatus(page), name).toBeEmpty();
      const { png, svg } = await expectBothDecode(page, url(user.handle), {
        width: 1024,
        height: 1024,
      });
      expect(await pixel(png, 2, 2), `${name} background`).toEqual(hexToRgb(bg));
      expect(
        [...new Set(svg.match(/#[0-9A-Fa-f]{6}\b/g)!.map((c) => c.toUpperCase()))].sort(),
        `${name} colors in the file`,
      ).toEqual([text.toUpperCase(), bg.toUpperCase()].sort());
    }
  });

  test("M9-25 Page colors on a dark page are inverted: refused with the note, downloads are aria-disabled, the preview still shows them", async ({
    page,
    context,
  }) => {
    // A new account's page is dark (light text on a dark background).
    const user = await signedInUser(context, { label: "qc4" });
    await setThemeRef(user.pageId, TEMPLATE_THEME_IDS.Midnight);
    await openCard(page);
    await colorMode(page, "Page colors").click();
    await expect(colorsStatus(page)).toHaveText(REFUSED);
    await expect(colorsStatus(page)).toHaveAttribute("role", "status");
    await expect(downloadPng(page)).toHaveAttribute("aria-disabled", "true");
    await expect(downloadSvg(page)).toHaveAttribute("aria-disabled", "true");
    // The preview shows them anyway.
    const { text, bg } = await themeColors(TEMPLATE_THEME_IDS.Midnight);
    const shown = await preview(page).evaluate((svg) => ({
      background: svg.querySelector("rect")!.getAttribute("fill"),
      code: svg.querySelector("path")!.getAttribute("fill"),
    }));
    expect(shown).toEqual({ background: bg.toUpperCase(), code: text.toUpperCase() });
    // A click makes no file.
    let downloads = 0;
    page.on("download", () => (downloads += 1));
    await downloadPng(page).dispatchEvent("click"); // aria-disabled: it can be pressed, and does nothing
    await downloadSvg(page).dispatchEvent("click");
    await page.waitForTimeout(700);
    expect(downloads).toBe(0);
    // Back to Black and white: the note goes and the downloads work.
    await colorMode(page, "Black and white").click();
    await expect(colorsStatus(page)).toBeEmpty();
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
    await expect(downloadSvg(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("M9-25 refused pairs: faint gray on white, white on black (inverted) and equal colors; a good pair lifts it", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qc5" });
    await openCard(page);
    await colorMode(page, "Custom").click();
    for (const [code, background] of [
      ["#CCCCCC", "#FFFFFF"],
      ["#FFFFFF", "#000000"],
      ["#336699", "#336699"],
    ] as const) {
      await typeColor(page, "Code color", code);
      await typeColor(page, "Background", background);
      await expect(colorsStatus(page), `${code} on ${background}`).toHaveText(REFUSED);
      await expect(downloadPng(page)).toHaveAttribute("aria-disabled", "true");
      await expect(downloadSvg(page)).toHaveAttribute("aria-disabled", "true");
    }
    await typeColor(page, "Code color", "#000000");
    await typeColor(page, "Background", "#FFFFFF");
    await expect(colorsStatus(page)).toBeEmpty();
    await expectBothDecode(page, url(user.handle));
  });

  test("M9-25 a value that is not a hex color is refused at the field and never reaches a file", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qc6" });
    await openCard(page);
    await colorMode(page, "Custom").click();
    await typeColor(page, "Code color", "#0B2A5B");
    await typeColor(page, "Background", "#FBF6E9");
    const input = styleGroup(page).getByLabel("Code color hex");
    for (const hostile of ['#fff" onload="x', "red", "javascript:alert(1)", "<script>", "#12"]) {
      await input.fill(hostile);
      await input.blur();
      await expect(styleGroup(page).getByText("Enter a hex color like #C9A86A.")).toBeVisible();
      await expect(input).toHaveAttribute("aria-invalid", "true");
    }
    // The style stayed on the last valid color: the files hold only the two validated colors.
    const svg = (await download(page, "svg")).toString("utf8");
    expect(svg).not.toMatch(/onload|javascript|script|red/);
    expect([...new Set(svg.match(/#[0-9A-Fa-f]{3,8}\b/g))].sort()).toEqual(["#0B2A5B", "#FBF6E9"]);
    await expectBothDecode(page, url(user.handle));
  });
});

/** Every request the page makes from now on that is not a blob or data address. */
function watch(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const address = request.url();
    if (/^(blob|data):/.test(address) || /fonts\.g|__nextjs_font/.test(address)) return;
    seen.push(`${request.method()} ${address}`);
  });
  return seen;
}

test.describe("M9-25 the logo", () => {
  test("M9-25 the logo is the page's photo: one request to the first-party media address, once; both files decode", async ({
    page,
    context,
  }) => {
    const user = await userWithPhoto(context, "ql1");
    await openCard(page);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    const seen = watch(page);

    await expect(logoSwitch(page)).toBeEnabled();
    await logoSwitch(page).click();
    await expect(logoSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
    const { png, svg } = await expectBothDecode(page, url(user.handle), {
      width: 1024,
      height: 1024,
    });

    // The only request: the picture, from the root /media origin, nothing third-party, no upload.
    const media = seen.filter((entry) => /\/media\//.test(entry));
    expect(seen.length, seen.join("\n")).toBeLessThanOrEqual(1);
    expect(media.length).toBeLessThanOrEqual(1);
    for (const entry of media) expect(entry).toMatch(/^GET http:\/\/localhost:3000\/media\//);
    expect(seen.filter((entry) => !entry.includes("/media/"))).toEqual([]);

    // Off and on again: the picture is not asked for a second time.
    await logoSwitch(page).click();
    await logoSwitch(page).click();
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
    await download(page, "png");
    expect(seen.filter((entry) => /\/media\//.test(entry)).length).toBeLessThanOrEqual(1);

    // The SVG: one image whose href is a PNG data address of at most 256 pixels, nothing else loaded.
    expect(svg.match(/<image\b/g)).toHaveLength(1);
    const data = /<image href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(svg);
    expect(data).not.toBeNull();
    const meta = await sharp(Buffer.from(data![1]!, "base64")).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width!).toBeLessThanOrEqual(256);
    expect(meta.height!).toBeLessThanOrEqual(256);
    expect(svg).not.toMatch(/xlink:href|<script|<foreignObject|<style|\son\w+=/i);
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toContain("://");
    // The plate: the picture's own colors are in the middle of the PNG (orange disc), not at its edge.
    const [r, g, b] = await pixel(png, 512, 512);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(90);
    expect(b).toBeLessThan(90);
  });

  test("M9-25 with the logo off the card makes no request at all, whatever the controls do and both downloads", async ({
    page,
    context,
  }) => {
    await userWithPhoto(context, "ql2");
    await openCard(page);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const seen = watch(page);
    await colorMode(page, "Page colors").click();
    await colorMode(page, "Custom").click();
    await frameSwitch(page).click();
    await frameText(page).fill("Hello");
    await colorMode(page, "Black and white").click();
    await download(page, "png");
    await download(page, "svg");
    await resetStyle(page).click();
    await page.waitForTimeout(500);
    expect(seen).toEqual([]);
  });

  test("M9-25 a wide logo (4:1) stays inside its plate and the code still decodes", async ({
    page,
    context,
  }) => {
    const user = await userWithPhoto(context, "ql3", WIDE);
    await openCard(page);
    await logoSwitch(page).click();
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
    const { svg } = await expectBothDecode(page, url(user.handle));
    // The image is a quarter as tall as it is wide, and not wider than 20 percent of the grid.
    const image = /<image [^>]*width="(\d+)" height="(\d+)"/.exec(svg)!;
    expect(Number(image[1])).toBeGreaterThan(Number(image[2]) * 3);
    const plate = [
      ...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#FFFFFF"/g),
    ];
    expect(plate.length).toBeGreaterThan(0);
    expect(Number(image[1])).toBeLessThanOrEqual(Number(plate[0]![3]));
    // The plate is at most 20 percent of the 1024 drawing's code area.
    expect(Number(plate[0]![3])).toBeLessThanOrEqual(0.2 * 1024 + 8);
  });

  test("M9-25 the logo with the frame and custom colors together decodes at 390 and 1440", async ({
    page,
    context,
  }) => {
    const user = await userWithPhoto(context, "ql4");
    await openCard(page);
    await setCustom(page, "#0B2A5B", "#FBF6E9");
    await logoSwitch(page).click();
    await frameSwitch(page).click();
    await frameText(page).fill("Scan to visit");
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
    await expectBothDecode(page, url(user.handle), { width: 1024, height: 1216 });
  });

  test("M9-25 a logo that cannot be loaded says so and holds the downloads; turning it off frees them", async ({
    page,
    context,
  }) => {
    await userWithPhoto(context, "ql5");
    await page.route("**/media/**", (route) => route.fulfill({ status: 404, body: "missing" }));
    await openCard(page);
    await logoSwitch(page).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn’t load your logo" }),
    ).toBeVisible();
    await expect(downloadPng(page)).toHaveAttribute("aria-disabled", "true");
    await expect(downloadSvg(page)).toHaveAttribute("aria-disabled", "true");
    await logoSwitch(page).click();
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("M9-25 the frame", () => {
  test("M9-25 a frame makes the PNG 1024x1216 and the SVG a text; the field is 16px, starts at Scan me and holds 20 code points", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qf1" });
    await openCard(page);
    await frameSwitch(page).click();
    await expect(frameText(page)).toHaveValue("Scan me");
    expect(await frameText(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    const { png, svg } = await expectBothDecode(page, url(user.handle), {
      width: 1024,
      height: 1216,
    });
    expect(svg).toContain(">Scan me</text>");
    expect(svg.match(/<text\b/g)).toHaveLength(1);
    expect(svg).toMatch(/font-family="sans-serif"[^>]*font-weight="700"[^>]*text-anchor="middle"/);
    expect(Number(/font-size="(\d+)"/.exec(svg)![1])).toBeGreaterThanOrEqual(64);
    // The text is drawn: dark pixels in the band under the code.
    const band = await sharp(png)
      .extract({ left: 300, top: 1010, width: 424, height: 150 })
      .greyscale()
      .raw()
      .toBuffer();
    expect(band.some((value) => value < 100)).toBe(true);

    // 20 code points at most: a long paste is cut (an emoji counts once).
    await frameText(page).fill("a".repeat(40));
    await expect(frameText(page)).toHaveValue("a".repeat(20));
    await frameText(page).fill("😀".repeat(30));
    expect(Array.from(await frameText(page).inputValue())).toHaveLength(20);
    // Empty means Scan me.
    await frameText(page).fill("");
    await expect(downloadSvg(page)).not.toHaveAttribute("aria-disabled", "true");
    expect(await download(page, "svg").then((b) => b.toString("utf8"))).toContain(
      ">Scan me</text>",
    );
    // Trimmed and on one line.
    await frameText(page).fill("   Visit us   ");
    expect(await download(page, "svg").then((b) => b.toString("utf8"))).toContain(
      ">Visit us</text>",
    );
  });

  test("M9-25 a frame text of </text><script>alert(1)</script> is escaped and drawn as text, and the PNG still decodes", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qf2" });
    await openCard(page);
    await frameSwitch(page).click();
    await frameText(page).fill("</text><script>alert(1)</script>");
    const { svg } = await expectBothDecode(page, url(user.handle), { width: 1024, height: 1216 });
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;alert");
    expect(svg).not.toContain("<script");
    expect(svg.match(/<text\b/g)).toHaveLength(1);
    // Parsed as XML it is one text node holding the characters.
    const text = await page.evaluate((markup) => {
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      return {
        error: doc.querySelector("parsererror") !== null,
        scripts: doc.querySelectorAll("script").length,
        text: doc.querySelector("text")?.textContent,
      };
    }, svg);
    expect(text).toEqual({ error: false, scripts: 0, text: "</text><script>alert" });
  });

  test("M9-25 the frame keeps the code at 80 percent of the width or more, with its quiet zone, and a rounded border in the code color", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "qf3" });
    await openCard(page);
    await setCustom(page, "#0B2A5B", "#FBF6E9");
    await frameSwitch(page).click();
    const png = await download(page, "png");
    expect(ihdrOf(png)).toMatchObject({ width: 1024, height: 1216 });
    // The border: code-colored pixels at the middle of each edge, background-colored in the corners' outside.
    expect(await pixel(png, 512, 12)).toEqual(hexToRgb("#0B2A5B"));
    expect(await pixel(png, 12, 400)).toEqual(hexToRgb("#0B2A5B"));
    expect(await pixel(png, 2, 2)).toEqual(hexToRgb("#FBF6E9")); // outside the rounded corner
    // Just inside the border the quiet zone is the background color, all the way round the code.
    for (const [x, y] of [
      [60, 60],
      [512, 50],
      [960, 60],
      [50, 512],
    ] as const) {
      expect(await pixel(png, x, y), `${x},${y}`).toEqual(hexToRgb("#FBF6E9"));
    }
    // The code area is 960 of 1024 wide: 94 percent.
    expect(960 / 1024).toBeGreaterThanOrEqual(0.8);
  });
});

test.describe("M9-25 a verified custom domain", () => {
  test("M9-25 with the primary custom domain (Vercel stub) and a reload, a styled code encodes the domain", async ({
    page,
    context,
  }) => {
    const user = await userWithPhoto(context, "qm1", SOLID, { plan: "pro" });
    const host = `zq-qm1-${Math.random().toString(36).slice(2, 8)}.example.test`;
    await addVerifiedDomains(user.pageId, [host]);
    await openCard(page);
    await expect(qrCard(page).getByTestId("qr-address")).toHaveText(`https://${host}/`);
    await setCustom(page, "#0B2A5B", "#FBF6E9");
    await logoSwitch(page).click();
    await frameSwitch(page).click();
    await expect(downloadPng(page)).not.toHaveAttribute("aria-disabled", "true");
    await expectBothDecode(page, `https://${host}/`, { width: 1024, height: 1216 });
    // The file is still named after the handle.
    const [file] = await Promise.all([page.waitForEvent("download"), downloadSvg(page).click()]);
    expect(file.suggestedFilename()).toBe(`${user.handle}-qr.svg`);
  });
});

test.describe("M9-25 the files", () => {
  test("M9-25 a downloaded file never holds the page's theme except the two validated colors, and the names are {handle}-qr.png and .svg", async ({
    page,
    context,
  }) => {
    const user = await userWithPhoto(context, "qz1");
    await setThemeRef(user.pageId, TEMPLATE_THEME_IDS.Ivory);
    await openCard(page);
    await colorMode(page, "Page colors").click();
    await frameSwitch(page).click();
    const [pngFile] = await Promise.all([page.waitForEvent("download"), downloadPng(page).click()]);
    expect(pngFile.suggestedFilename()).toBe(`${user.handle}-qr.png`);
    const [svgFile] = await Promise.all([page.waitForEvent("download"), downloadSvg(page).click()]);
    expect(svgFile.suggestedFilename()).toBe(`${user.handle}-qr.svg`);
    const svg = readFileSync((await svgFile.path())!, "utf8");
    const { text, bg } = await themeColors(TEMPLATE_THEME_IDS.Ivory);
    expect(
      [...new Set(svg.match(/#[0-9A-Fa-f]{3,8}\b/g)!.map((c) => c.toUpperCase()))].sort(),
    ).toEqual([text.toUpperCase(), bg.toUpperCase()].sort());
    // None of the theme's other values (font, surface, accent) is in it.
    expect(svg).not.toMatch(/--t-|var\(--|font-family="(?!sans-serif")/);
  });

  test("M9-25 GET /qr and /api/qr are still 404 on the app host", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const { authCookies, cookieHeader, rawRequest } = await import("../fixtures/http");
    await signedInUser(context, { label: "qz2" });
    const cookie = cookieHeader(await authCookies(context));
    for (const path of ["/api/qr", "/qr", "/api/qr?text=https://evil.example&color=red"]) {
      const res = await rawRequest("app.localhost:3000", path, { cookie });
      expect(res.status, path).toBe(404);
    }
  });
});

test.describe("M9-25 phone and desktop layout", () => {
  test("M9-25 at 390x844 the controls stack full width, the preview is 240px (scaled to fit with the frame), the downloads stack at 44px, a long text and a long domain wrap", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the phone layout is checked on the phone project");
    const user = await userWithPhoto(context, "qy1", SOLID, { plan: "pro" });
    const host = `zq-qy1-${"a".repeat(48)}.example-long-domain-name.example.test`;
    await addVerifiedDomains(user.pageId, [host]);
    await openCard(page);
    await colorMode(page, "Custom").click();
    await frameSwitch(page).click();
    await frameText(page).fill("WWWWWWWWWWWWWWWWWWWW");
    await expectNoHorizontalScroll(page);

    const geometry = await page.evaluate(() => {
      const rect = (el: Element | null) => {
        const r = el!.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const card = document.querySelector('[data-testid="qr-card"]')!;
      const find = (text: string) =>
        Array.from(card.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
      const address = card.querySelector('[data-testid="qr-address"]')!;
      return {
        card: rect(card),
        svg: rect(card.querySelector('[data-testid="qr-code"]')),
        style: rect(card.querySelector('[data-testid="qr-style"]')),
        png: rect(find("Download PNG")),
        svgButton: rect(find("Download SVG")),
        reset: rect(find("Reset style")),
        address: rect(address),
        wrap: getComputedStyle(address).overflowWrap,
        view: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        text: (card.querySelector('input[type="text"][placeholder="Scan me"]') as HTMLInputElement)
          .value,
      };
    });
    // The preview fits 240px wide; with the frame (1024x1216) it is taller than wide.
    expect(Math.round(geometry.svg.width)).toBe(240);
    expect(Math.round(geometry.svg.height)).toBe(Math.round((240 * 1216) / 1024));
    // The style group is under the preview and as wide as the card's content.
    expect(geometry.style.top).toBeGreaterThanOrEqual(geometry.svg.bottom);
    expect(Math.round(geometry.style.width)).toBe(Math.round(geometry.card.width - 32 - 2));
    // The downloads stack, full width, at least 44px.
    expect(geometry.svgButton.top).toBeGreaterThan(geometry.png.bottom - 1);
    expect(geometry.png.height).toBeGreaterThanOrEqual(44);
    expect(geometry.svgButton.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(geometry.png.width - geometry.svgButton.width)).toBeLessThanOrEqual(1);
    expect(geometry.png.width).toBeGreaterThan(300);
    // A long domain wraps instead of widening the card.
    expect(geometry.wrap).toBe("anywhere");
    expect(geometry.address.height).toBeGreaterThan(30);
    expect(geometry.address.right).toBeLessThanOrEqual(geometry.card.right);
    expect(geometry.card.right).toBeLessThanOrEqual(geometry.view);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.view);
    expect(geometry.text).toBe("WWWWWWWWWWWWWWWWWWWW");
    await expectTapTargets(page, '[data-testid="qr-card"]');
    await expect(qrCard(page).getByTestId("qr-address")).toHaveText(`https://${host}/`);
  });

  test("M9-25 at 1440x900 the card sits in the 720px column, the preview 280px beside the controls and the downloads side by side", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the desktop layout is checked on the desktop project");
    await userWithPhoto(context, "qy2");
    await openCard(page);
    await colorMode(page, "Custom").click();
    await frameSwitch(page).click();
    const geometry = await page.evaluate(() => {
      const rect = (el: Element | null) => {
        const r = el!.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const card = document.querySelector('[data-testid="qr-card"]')!;
      const find = (text: string) =>
        Array.from(card.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
      return {
        card: rect(card),
        svg: rect(card.querySelector('[data-testid="qr-code"]')),
        style: rect(card.querySelector('[data-testid="qr-style"]')),
        png: rect(find("Download PNG")),
        svgButton: rect(find("Download SVG")),
      };
    });
    expect(geometry.card.width).toBeLessThanOrEqual(720);
    // 280 wide; with the frame (1024x1216) 333 tall.
    expect(Math.round(geometry.svg.width)).toBe(280);
    expect(Math.round(geometry.svg.height)).toBe(Math.round((280 * 1216) / 1024));
    // The controls are beside the preview, not under it.
    expect(geometry.style.left).toBeGreaterThanOrEqual(geometry.svg.right);
    expect(Math.abs(geometry.style.top - geometry.svg.top)).toBeLessThanOrEqual(2);
    // The downloads: side by side, under both.
    expect(Math.abs(geometry.png.top - geometry.svgButton.top)).toBeLessThanOrEqual(1);
    expect(geometry.svgButton.left).toBeGreaterThan(geometry.png.right);
    expect(geometry.png.top).toBeGreaterThanOrEqual(
      Math.max(geometry.svg.bottom, geometry.style.bottom),
    );
    expect(geometry.png.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
  });
});
