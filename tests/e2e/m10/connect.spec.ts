import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * M10-34: the /connect page, "Use HYDLNK from Claude or ChatGPT". Document, sections in order,
 * the connector address with its Copy button, the Claude and ChatGPT steps (the labels of the
 * vendors' own pages as read on 2026-10-04), privacy, turning it off, and the layout at 390 and
 * 1440. The source of the page (constants, documentation URLs) is tests/unit/m10-connect-source.test.ts.
 */

const PATH = "/connect";
const TITLE = "Use HYDLNK from Claude or ChatGPT";
const ADDRESS = "https://app.hydlnk.com/mcp";

const SECTIONS = [
  ["what-it-does", "What it does"],
  ["can-do", "What it can do"],
  ["cant-do", "What it can’t do"],
  ["claude", "Connect Claude"],
  ["chatgpt", "Connect ChatGPT"],
  ["privacy", "Your privacy"],
  ["turn-off", "Turn it off"],
  ["good-to-know", "Good to know"],
] as const;

/** The text of one section: everything between its h2 and the next one. */
async function sectionText(page: Page, id: string): Promise<string> {
  return page.evaluate((sectionId) => {
    const heading = document.getElementById(sectionId);
    let text = "";
    let el = heading?.nextElementSibling ?? null;
    while (el && el.tagName !== "H2") {
      text += ` ${(el as HTMLElement).innerText}`;
      el = el.nextElementSibling;
    }
    return text.replace(/\s+/g, " ").trim();
  }, id);
}

test.describe("M10-34 the document", () => {
  test("M10-34 answers 200 on the marketing host with the title, one h1, a description, a canonical URL and no cookie", async ({
    page,
  }) => {
    const raw = await rawRequest("localhost:3000", PATH);
    expect(raw.status).toBe(200);
    expect(raw.headers["set-cookie"]).toBeUndefined();

    const response = await page.goto(url(null, PATH));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["set-cookie"]).toBeUndefined();
    await expect(page).toHaveTitle(`${TITLE} | HYDLNK`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{60,}/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url(null, PATH));
    expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual([]);
  });

  test("M10-34 has the marketing chrome: skip link, charcoal header, one main, the footer", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    expect(
      await page
        .locator("header")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(28, 27, 26)");
    await expect(page.locator("main#main")).toHaveCount(1);
    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute(
      "href",
      "/privacy",
    );
    // It is not a header page: the header's own links (the menu on a phone included) do not list it.
    await expect(page.locator('header a[href="/connect"]')).toHaveCount(0);
  });

  test("M10-34 makes no request to a third-party host, sets no cookie and passes axe with no serious or critical violation", async ({
    page,
  }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const target = new URL(request.url());
      if (target.protocol === "http:" || target.protocol === "https:") hosts.add(target.host);
    });
    await page.goto(url(null, PATH), { waitUntil: "networkidle" });
    const own = new URL(url(null, "/")).host;
    expect([...hosts].filter((host) => host !== own)).toEqual([]);
    const loaded = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "script[src], img[src], iframe[src], link[rel=stylesheet][href], link[rel=preload][href]",
        ),
      ].map(
        (el) =>
          (el as HTMLElement).getAttribute("src") ?? (el as HTMLElement).getAttribute("href") ?? "",
      ),
    );
    for (const resource of loaded) {
      if (/^https?:\/\//.test(resource)) expect(new URL(resource).host, resource).toBe(own);
    }
    expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual([]);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M10-34 is in the sitemap, and nothing else was added to it", async ({ request }) => {
    const sitemap = await request.get(url(null, "/sitemap.xml"));
    const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.filter((loc) => loc === url(null, PATH))).toHaveLength(1);
    // Marketing pages only: no app-host or tenant address.
    const own = new URL(url(null, "/")).host;
    expect(locs.filter((loc) => new URL(loc!).host !== own)).toEqual([]);
  });
});

test.describe("M10-34 the sections", () => {
  test("M10-34 the eight sections are h2s with ids, in the order the page promises", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const headings = await page
      .locator("main article h2")
      .evaluateAll((els) => els.map((el) => [el.id, (el.textContent ?? "").trim()]));
    expect(headings).toEqual(SECTIONS.map(([id, title]) => [id, title]));
    // The "On this page" chips reach each one.
    const chips = page.getByRole("navigation", { name: "On this page" });
    for (const [id, title] of SECTIONS) {
      await expect(chips.getByRole("link", { name: title, exact: true })).toHaveAttribute(
        "href",
        `#${id}`,
      );
    }
  });

  test("M10-34 'What it does' says what the AI does, that it works on the draft, and what MCP is", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const text = await sectionText(page, "what-it-does");
    for (const phrase of [
      /Claude or ChatGPT/,
      /add a link/i,
      /reword my bio/i,
      /theme/i,
      /last week/i,
      /publish/i,
      /works on your draft/i,
      /allow/i,
      /MCP, short for Model Context Protocol: a standard way for AI apps to connect to other apps/,
    ]) {
      expect(text, String(phrase)).toMatch(phrase);
    }
  });

  test("M10-34 'What it can do' and 'What it can’t do' list what the spec says", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const can = await sectionText(page, "can-do");
    for (const phrase of [
      /See your pages and your numbers/,
      /Edit your profile/,
      /links and the other blocks/,
      /Change your theme/,
      /private preview link/,
      /7 days/,
      /custom domains/,
      /Publish your page, if you allowed publishing/,
    ]) {
      expect(can, String(phrase)).toMatch(phrase);
    }
    expect(await page.locator("#can-do ~ ul").first().locator("li").count()).toBe(7);
    const cannot = await sectionText(page, "cant-do");
    for (const phrase of [
      /Sign in as anyone else/,
      /see other people’s pages/,
      /Change your plan or your billing/,
      /Add or remove custom domains/,
      /Upload new images/,
      /reuse images that are already on your pages/,
      /banner/,
      /share card/,
      /redirect settings/,
      /Delete anything except a block/,
      /unless you allowed it/,
    ]) {
      expect(cannot, String(phrase)).toMatch(phrase);
    }
  });
});

test.describe("M10-34 the connector address", () => {
  test("M10-34 is always the production address, in a mono block, even on the local host", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const block = page.getByTestId("connector-address");
    await expect(block).toHaveText(ADDRESS);
    expect(await block.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase())).toContain(
      "mono",
    );
    // Never the local root domain: no address in the page body or its code blocks names localhost.
    expect(await page.locator("main article").innerText()).not.toContain("localhost");
    expect(await page.locator("main article code, main article pre").allInnerTexts()).not.toEqual(
      expect.arrayContaining([expect.stringContaining("localhost")]),
    );
    // The address in the steps is the same string.
    for (const id of ["claude", "chatgpt"]) {
      expect(await sectionText(page, id)).toContain(ADDRESS);
    }
  });

  test("M10-34 the Copy button copies exactly that string and says so", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url(null) });
    await page.goto(url(null, PATH));
    const copy = page.getByRole("button", { name: "Copy", exact: true });
    await expect(copy).toHaveCount(1);
    expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Hydrated: the button's React props are attached.
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Copy");
      return !!button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
    });
    await copy.click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Address copied." })).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ADDRESS);
    // And it goes back to Copy.
    await expect(copy).toBeVisible({ timeout: 4000 });
  });

  test("M10-34 without clipboard access the address is selected for a manual copy", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("blocked")) },
        configurable: true,
      });
    });
    await page.goto(url(null, PATH));
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Copy");
      return !!button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
    });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(ADDRESS);
  });
});

test.describe("M10-34 Connect Claude", () => {
  test("M10-34 uses the labels of Claude's own documentation, with the notes for Team, the Free plan and Claude Code", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const text = await sectionText(page, "claude");
    for (const phrase of [
      /as of October 2026/,
      /Customize, then Connectors/,
      /Add custom connector/,
      /MCP server URL/,
      /Sign in now/,
      /Use Claude’s published identity/,
      /choose Add, then choose Connect/i,
      /Sign in to HYDLNK, choose what to allow, and choose Allow/,
      /Owner adds HYDLNK first, under Organization settings, then Connectors \(choose Add, then Custom, then Web\)/,
      /each person then finds HYDLNK under Customize, then Connectors, and chooses Connect/i,
      /Free plan allows one custom connector/,
      /Claude Code/,
      /claude mcp add --transport http hydlnk https:\/\/app\.hydlnk\.com\/mcp/,
      /type \/mcp, choose hydlnk and choose Authenticate/,
    ]) {
      expect(text, String(phrase)).toMatch(phrase);
    }
    // Five numbered steps, each a list item.
    expect(await page.locator("#claude ~ ol").first().locator("> li").count()).toBe(5);
  });
});

test.describe("M10-34 Connect ChatGPT", () => {
  test("M10-34 follows OpenAI's page, says menus change, and makes no claim about which plans can do it", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const text = await sectionText(page, "chatgpt");
    for (const phrase of [
      /as of October 2026/,
      /Settings, then Security and login, and turn on Developer mode/,
      /Plugins page and select the plus button/,
      /name, such as HYDLNK, and a short description/,
      /Under Connection, choose a public endpoint/,
      /tools menu/,
      /ChatGPT’s menus change often\. If a label differs, look for developer mode or custom connectors in your settings\./,
      /depends on your account and your workspace/,
    ]) {
      expect(text, String(phrase)).toMatch(phrase);
    }
    // No plan names: availability is the account's and the workspace's.
    expect(text).not.toMatch(/\b(Plus|Pro|Business|Enterprise|Edu|Team|Studio|Free)\b/);
    expect(await page.locator("#chatgpt ~ ol").first().locator("> li").count()).toBe(5);
  });
});

test.describe("M10-34 privacy, turning it off, good to know", () => {
  test("M10-34 'Your privacy' states the retention from the constant and links to the policy section", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const text = await sectionText(page, "privacy");
    expect(text).toMatch(/what you allow and what you ask it to read/);
    expect(text).toMatch(/page drafts, your numbers and your list of custom domains/);
    expect(text).toMatch(/which action, which page, when, and whether it worked/);
    expect(text).toMatch(/never holds your content/);
    expect(text).toMatch(/after 90 days/);
    expect(text).toMatch(/its own privacy policy/);
    expect(text).toMatch(/never sees your chats/);
    const link = page.locator("#privacy ~ a[href='/privacy#connected-apps']");
    await expect(link).toHaveCount(1);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("M10-34 'Turn it off' names Settings & billing, Connected apps and Revoke, and links to the app's Settings", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const text = await sectionText(page, "turn-off");
    expect(text).toMatch(/Settings & billing, find Connected apps and choose Revoke/);
    expect(text).toMatch(/loses access at once/);
    expect(text).toMatch(/remove HYDLNK from Claude or ChatGPT/);
    const link = page.locator("#turn-off ~ a", { hasText: "Open Settings & billing" });
    await expect(link).toHaveAttribute("href", url("app", "/settings"));
  });

  test("M10-34 'Good to know' states every plan, the limits and the analytics windows from the constants", async ({
    page,
  }) => {
    await page.goto(url(null, PATH));
    const text = await sectionText(page, "good-to-know");
    expect(text).toMatch(/every plan, Free included/);
    expect(text).toMatch(/about 60 requests a minute/);
    expect(text).toMatch(/up to 10 times an hour/);
    expect(text).toMatch(/Free covers the last 30 days/);
    expect(text).toMatch(
      /Pro and Studio cover up to a year, with referrers, devices and countries/,
    );
    expect(text).toMatch(/saved to your draft straight away, so check the editor/);
  });
});

test.describe("M10-34 the layout", () => {
  test("M10-34 at 390: nothing scrolls sideways, the address block stays inside, 44px targets, steps wrap", async ({
    page,
  }, info) => {
    test.skip(!phoneOnly(info), "the phone layout");
    await page.goto(url(null, PATH));
    await expectNoHorizontalScroll(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    );
    // The address block wraps or scrolls inside itself.
    const block = (await page.getByTestId("connector-address").boundingBox())!;
    expect(block.x).toBeGreaterThanOrEqual(0);
    expect(block.x + block.width).toBeLessThanOrEqual(390 + 0.5);
    // The Copy button is on its own row, full width, 44px tall.
    const copy = (await page.getByRole("button", { name: "Copy", exact: true }).boundingBox())!;
    expect(copy.height).toBeGreaterThanOrEqual(44);
    expect(copy.y).toBeGreaterThan(block.y + block.height - 1);
    // Every link, button and footer link is at least 44px tall.
    await expectTapTargets(page);
    for (const link of await page
      .getByRole("navigation", { name: "Footer" })
      .getByRole("link")
      .all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // The numbered steps wrap without clipping, and the command block stays inside the screen.
    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll(
        ".prose-hl ol li, .prose-hl ul li, .prose-hl pre",
      )) {
        const rect = el.getBoundingClientRect();
        if (el.scrollWidth > el.clientWidth + 1 || rect.right > window.innerWidth + 0.5) {
          bad.push(`${el.tagName} ${(el.textContent ?? "").slice(0, 40)}`);
        }
      }
      return bad;
    });
    expect(clipped).toEqual([]);
    // The reading column fills the phone with a gutter each side, in 16px text.
    const column = (await page.locator(".prose-hl").boundingBox())!;
    expect(column.x).toBeGreaterThanOrEqual(16);
    expect(column.x + column.width).toBeLessThanOrEqual(390 - 16 + 0.5);
    expect(
      await page
        .locator(".prose-hl p")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  });

  test("M10-34 at 1440: a centered reading column no wider than 70 characters, steps as numbered lists, the address and its button on one line", async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "the desktop layout");
    await page.goto(url(null, PATH));
    await expectNoHorizontalScroll(page);
    const column = (await page.locator(".prose-hl").boundingBox())!;
    const viewport = page.viewportSize()!.width;
    expect(Math.abs(column.x - (viewport - (column.x + column.width)))).toBeLessThanOrEqual(2);
    const seventy = await page.locator(".prose-hl").evaluate((el) => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = getComputedStyle(el).font;
      return 70 * context.measureText("0").width;
    });
    expect(column.width).toBeLessThanOrEqual(seventy + 1);
    // The header's text sits in the same column.
    const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(Math.abs(heading.x - column.x)).toBeLessThanOrEqual(2);
    // Steps read as numbered lists.
    for (const id of ["claude", "chatgpt"]) {
      const style = await page
        .locator(`#${id} ~ ol`)
        .first()
        .evaluate((el) => getComputedStyle(el).listStyleType);
      expect(style).toBe("decimal");
    }
    // The address block and its button sit on one line.
    const block = (await page.getByTestId("connector-address").boundingBox())!;
    const copy = (await page.getByRole("button", { name: "Copy", exact: true }).boundingBox())!;
    expect(Math.abs(block.y + block.height / 2 - (copy.y + copy.height / 2))).toBeLessThanOrEqual(
      6,
    );
    expect(copy.x).toBeGreaterThan(block.x + block.width - 1);
  });
});
