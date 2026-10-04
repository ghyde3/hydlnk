import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { openTab } from "../m7/workspace-helpers";
import { MCP_ACTIVITY_RETENTION_DAYS } from "@/lib/mcp/constants";

/**
 * M10-35: /connect in the footer and the sitemap, a section on Features, a group in the FAQ and a
 * section in the privacy policy, plus the editor's pointer to /connect (the Share tab's last card).
 * The sources of these (the constants the policy reads, the section order) are in
 * tests/unit/m10-connect-source.test.ts; the page itself is connect.spec.ts.
 */

test.afterAll(cleanupUsers);

const NEW_FOOTER_LABEL = "Use with Claude or ChatGPT";

const FAQ_QUESTIONS = [
  "Can I use HYDLNK from Claude or ChatGPT?",
  "Is it on every plan?",
  "Can the AI publish my page without asking?",
  "What can the AI see?",
  "How do I turn it off?",
];

const PRIVACY_IDS = [
  "summary",
  "who",
  "collect",
  "visitors",
  "use",
  "connected-apps",
  "legal-bases",
  "cookies",
  "processors",
  "sharing",
  "transfers",
  "retention",
  "rights",
  "children",
  "security",
  "page-owners",
  "changes",
  "contact",
];

/** No third-party request, no cookie, axe clean. */
async function expectCleanPage(page: Page, path: string): Promise<void> {
  const hosts = new Set<string>();
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (target.protocol === "http:" || target.protocol === "https:") hosts.add(target.host);
  });
  await page.goto(url(null, path), { waitUntil: "networkidle" });
  const own = new URL(url(null, "/")).host;
  expect(
    [...hosts].filter((host) => host !== own),
    `${path} third-party hosts`,
  ).toEqual([]);
  expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual([]);
  expect(await axeViolations(page), path).toEqual([]);
}

test.describe("M10-35 the footer, the header and the sitemap", () => {
  test("M10-35 the footer's Product column has 'Use with Claude or ChatGPT' on every marketing page, 44px tall", async ({
    page,
  }, info) => {
    for (const path of ["/", "/features", "/faq", "/privacy", "/connect"]) {
      await page.goto(url(null, path));
      const footer = page.getByRole("navigation", { name: "Footer" });
      const link = footer.getByRole("link", { name: NEW_FOOTER_LABEL, exact: true });
      await expect(link, path).toHaveCount(1);
      await expect(link, path).toHaveAttribute("href", "/connect");
      const box = (await link.boundingBox())!;
      expect(box.height, path).toBeGreaterThanOrEqual(44);
      if (desktopOnly(info)) {
        // One line in its column: the column does not wrap badly.
        expect(box.height, `${path} wraps`).toBeLessThanOrEqual(48);
        const column = footer.getByText("Product", { exact: true }).locator("xpath=..");
        const columnBox = (await column.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(columnBox.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(columnBox.x + columnBox.width + 1);
      }
    }
    // It is in the Product column, after the five that were there.
    await page.goto(url(null, "/"));
    const product = page
      .getByRole("navigation", { name: "Footer" })
      .getByText("Product", { exact: true })
      .locator("xpath=..");
    await expect(product.getByRole("link")).toHaveText([
      "Features",
      "Design",
      "Custom domains",
      "Analytics",
      "Pricing",
      NEW_FOOTER_LABEL,
    ]);
  });

  test("M10-35 the header's six links are unchanged", async ({ page }, info) => {
    test.skip(!desktopOnly(info), "the header's link row shows from tablet width");
    await page.goto(url(null, "/"));
    const links = await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link")
      .evaluateAll((els) => els.map((el) => [el.textContent?.trim(), el.getAttribute("href")]));
    expect(links.slice(0, 6)).toEqual([
      ["Features", "/features"],
      ["Design", "/design-control"],
      ["Domains", "/custom-domains"],
      ["Analytics", "/link-analytics"],
      ["Pricing", "/pricing"],
      ["Learn", "/learn"],
    ]);
    expect(links.map((link) => link[1])).not.toContain("/connect");
  });

  test("M10-35 sitemap.xml lists /connect once, and only the marketing host's pages", async ({
    request,
  }) => {
    const response = await request.get(url(null, "/sitemap.xml"));
    expect(response.status()).toBe(200);
    const locs = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.filter((loc) => loc === url(null, "/connect"))).toHaveLength(1);
    const own = new URL(url(null, "/")).host;
    expect(locs.filter((loc) => new URL(loc).host !== own)).toEqual([]);
    expect(new Set(locs).size).toBe(locs.length);
  });
});

test.describe("M10-35 the Features section", () => {
  test("M10-35 sits after Publishing and before Safe by default, with its own id, copy and link", async ({
    page,
  }) => {
    await page.goto(url(null, "/features"));
    // The page's existing sections and anchors keep their order; the new one is between two of them.
    const ids = await page
      .locator("main > section[id]")
      .evaluateAll((els) => els.map((el) => el.id));
    expect(ids).toEqual([
      "blocks",
      "profile",
      "editor",
      "publishing",
      "ai-apps",
      "safety",
      "links",
    ]);
    const heading = page.locator("section#ai-apps h2");
    await expect(heading).toHaveAttribute("id", "ai-apps-title");
    await expect(heading).toHaveText("Use it from Claude or ChatGPT");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const text = (await page.locator("section#ai-apps").innerText()).replace(/\s+/g, " ");
    expect(text).toMatch(
      /add a link, reword your bio, switch your theme or check last week’s numbers/,
    );
    expect(text).toMatch(/publishes only if you allowed that/);
    expect(text).toMatch(/every plan, free included/);
    // Two or three plain sentences.
    const lead = (await page.locator("section#ai-apps h2 + p").innerText()).trim();
    expect(lead.split(/(?<=[.?])\s+/).length).toBeLessThanOrEqual(3);
    const link = page.locator("section#ai-apps").getByRole("link", { name: /See how to connect/ });
    await expect(link).toHaveAttribute("href", "/connect");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The bands keep alternating white and #F4F3F0.
    const tones = await page
      .locator("main > section[id]")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    for (let i = 1; i < tones.length; i++)
      expect(tones[i], `band ${ids[i]}`).not.toBe(tones[i - 1]);
  });

  test("M10-35 the section sits in the page's grid and fits at both sizes", async ({
    page,
  }, info) => {
    await page.goto(url(null, "/features"));
    await expectNoHorizontalScroll(page);
    const aiTitle = (await page.locator("h2#ai-apps-title").boundingBox())!;
    const publishingTitle = (await page.locator("h2#publishing-title").boundingBox())!;
    // Same left edge as the sections around it.
    expect(Math.abs(aiTitle.x - publishingTitle.x)).toBeLessThanOrEqual(1);
    if (phoneOnly(info)) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth),
      );
      await expectTapTargets(page, "section#ai-apps");
      for (const link of await page
        .getByRole("navigation", { name: "Footer" })
        .getByRole("link")
        .all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      const container = (await page.locator("section#ai-apps > div").boundingBox())!;
      expect(aiTitle.x).toBeGreaterThanOrEqual(container.x);
      expect(aiTitle.x + aiTitle.width).toBeLessThanOrEqual(container.x + container.width + 1);
    }
  });

  test("M10-35 the Features page is clean: no third-party request, no cookie, axe", async ({
    page,
  }) => {
    await expectCleanPage(page, "/features");
  });
});

test.describe("M10-35 the FAQ group", () => {
  test("M10-35 'Claude and ChatGPT' (ai-apps) has the five questions as native details that open and close", async ({
    page,
  }) => {
    await page.goto(url(null, "/faq"));
    const group = page.locator("section#ai-apps");
    await expect(group.getByRole("heading", { level: 2 })).toHaveText("Claude and ChatGPT");
    await expect(
      page
        .getByRole("navigation", { name: "Topics" })
        .getByRole("link", { name: "Claude and ChatGPT" }),
    ).toHaveAttribute("href", "#ai-apps");
    const summaries = group.locator("details > summary");
    await expect(summaries).toHaveText(
      FAQ_QUESTIONS.map((question) => new RegExp(`^${question.replace(/[?]/g, "\\?")}`)),
    );
    for (const details of await group.locator("details").all()) {
      await expect(details).not.toHaveAttribute("open", "");
      await details.locator("summary").click();
      await expect(details).toHaveAttribute("open", "");
      expect((await details.locator("summary").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await details.locator("summary").click();
      await expect(details).not.toHaveAttribute("open", "");
    }
    // The answers are plain and agree with /connect.
    const ask = async (question: string) => {
      const details = group.locator("details", { hasText: question });
      await details.locator("summary").click();
      return (await details.locator("p").innerText()).replace(/\s+/g, " ");
    };
    expect(await ask("Is it on every plan?")).toMatch(/Free, Pro and Studio/);
    expect(await ask("Can the AI publish my page without asking?")).toMatch(/Only if you allow it/);
    expect(await ask("How do I turn it off?")).toMatch(
      /Settings & billing, find Connected apps and choose Revoke/,
    );
  });

  test("M10-35 the FAQPage structured data reads the group, and the home page's subset is unchanged", async ({
    page,
  }) => {
    await page.goto(url(null, "/faq"));
    const json = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}",
    ) as { mainEntity: { name: string }[] };
    const names = json.mainEntity.map((item) => item.name);
    for (const question of FAQ_QUESTIONS) expect(names).toContain(question);
    await page.goto(url(null, "/"));
    const home = page.locator("#faq details");
    await expect(home).toHaveCount(6);
    const homeText = await home.locator("summary").allInnerTexts();
    for (const question of FAQ_QUESTIONS) expect(homeText.join("|")).not.toContain(question);
  });

  test("M10-35 the FAQ page is clean and fits", async ({ page }, info) => {
    await expectCleanPage(page, "/faq");
    await page.goto(url(null, "/faq"));
    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      await expectTapTargets(page, "section#ai-apps");
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll("section#ai-apps summary, section#ai-apps details")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.tagName),
      );
      expect(clipped).toEqual([]);
    }
  });
});

test.describe("M10-35 the privacy policy", () => {
  test("M10-35 keeps its one h1, its sections and their anchors, and adds #connected-apps after 'How we use information'", async ({
    page,
  }) => {
    await page.goto(url(null, "/privacy"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
    const ids = await page.locator(".prose-hl h2").evaluateAll((els) => els.map((el) => el.id));
    expect(ids).toEqual(PRIVACY_IDS);
    await expect(page.locator("h2#connected-apps")).toHaveText("Connected AI apps");
    const contents = page.getByRole("navigation", { name: "Contents" });
    const labels = await contents.getByRole("link").allInnerTexts();
    const index = labels.findIndex((label) => label.includes("Connected AI apps"));
    expect(index).toBeGreaterThan(-1);
    expect(labels[index - 1]).toContain("How we use information");
    expect(labels[index + 1]).toContain("Legal bases");
    await expect(contents.getByRole("link", { name: /Connected AI apps/ })).toHaveAttribute(
      "href",
      "#connected-apps",
    );
    // Every entry still goes to a heading that exists.
    for (const href of await contents
      .getByRole("link")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")))) {
      await expect(page.locator(href!), href!).toHaveCount(1);
    }
    // The section moved Privacy to its own date (Gary, 2026-10-04); Terms and the shared default stay.
    await expect(page.getByText("Last updated October 4, 2026", { exact: true })).toBeVisible();
  });

  test("M10-35 the section says what is stored, what an app can do, who handles it, the lifetimes, removal and cookies", async ({
    page,
  }) => {
    await page.goto(url(null, "/privacy"));
    const section = await page.evaluate(() => {
      let text = "";
      let el = document.getElementById("connected-apps")?.nextElementSibling ?? null;
      while (el && el.tagName !== "H2") {
        text += ` ${(el as HTMLElement).innerText}`;
        el = el.nextElementSibling;
      }
      return text.replace(/\s+/g, " ").trim();
    });
    for (const phrase of [
      /The app’s name and web address, which permissions you allowed, when you connected it and when it was last used/,
      /only as one-way hashes/,
      /names the action, the page, the time and whether it worked, and it never holds your content/,
      new RegExp(`We keep it for ${MCP_ACTIVITY_RETENTION_DAYS} days`),
      /read your drafts, your analytics and your domain list, edit your drafts and publish your pages/,
      /Anthropic for Claude or OpenAI for ChatGPT/,
      /under its own privacy policy/,
      /HYDLNK doesn’t send your data to an AI company on its own/,
      /access ends after an hour and is renewed/,
      /unused for 60 days ends/,
      /Settings & billing .* Connected apps and choose Revoke/,
      /Deleting your account also removes every connection/,
      /set no cookies/,
    ]) {
      expect(section, String(phrase)).toMatch(phrase);
    }
  });

  test("M10-35 the short version, the sharing list and the retention list each gain their line, from the one constant", async ({
    page,
  }) => {
    await page.goto(url(null, "/privacy"));
    const prose = page.locator(".prose-hl");
    await expect(prose.locator("#summary + ul")).toContainText(
      "If you connect an AI app, it can only do what you allow, and you can remove it at any time.",
    );
    await expect(prose.locator("#sharing + ul")).toContainText(
      "With an AI app you connect: only what you ask it to read, through the permissions you allowed.",
    );
    const retention = prose.locator("#retention + ul");
    await expect(retention).toContainText(
      `Connected app activity: ${MCP_ACTIVITY_RETENTION_DAYS} days.`,
    );
    // The retention number is the same one in the section.
    const text = (await prose.innerText()).replace(/\s+/g, " ");
    expect(
      text.match(new RegExp(`${MCP_ACTIVITY_RETENTION_DAYS} days`, "g"))?.length,
    ).toBeGreaterThanOrEqual(2);
    // The events line still says what it said.
    await expect(retention).toContainText("Individual visitor events: 60 days");
  });

  test("M10-35 the privacy page is clean: no third-party request, no cookie, axe", async ({
    page,
  }) => {
    await expectCleanPage(page, "/privacy");
  });

  test("M10-35 at 390 the new section wraps without clipping; at 1440 the contents list stays the sticky left column", async ({
    page,
  }, info) => {
    await page.goto(url(null, "/privacy"));
    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth),
      );
      const clipped = await page.evaluate(() => {
        const bad: string[] = [];
        let el = document.getElementById("connected-apps")?.nextElementSibling ?? null;
        while (el && el.tagName !== "H2") {
          if (el.scrollWidth > el.clientWidth + 1)
            bad.push(`${el.tagName} ${el.textContent?.slice(0, 40)}`);
          el = el.nextElementSibling;
        }
        document.querySelectorAll('nav[aria-label="Contents"] a').forEach((a) => {
          if (a.scrollWidth > a.clientWidth + 1) bad.push(`A ${a.textContent}`);
        });
        return bad;
      });
      expect(clipped).toEqual([]);
      await expectTapTargets(page, "nav[aria-label='Contents']");
      for (const link of await page
        .getByRole("navigation", { name: "Footer" })
        .getByRole("link")
        .all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      const contents = page.getByRole("navigation", { name: "Contents" });
      expect(await contents.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
      const toc = (await contents.boundingBox())!;
      const column = (await page.locator(".prose-hl").boundingBox())!;
      expect(toc.x + toc.width).toBeLessThanOrEqual(column.x);
      await expect(contents.getByRole("link", { name: /Connected AI apps/ })).toBeVisible();
    }
  });
});

test.describe("M10-35 the editor's pointer to /connect", () => {
  test("M10-35 the Share tab ends with a 'Use with Claude or ChatGPT' card linking to the marketing page", async ({
    page,
    context,
    request,
  }) => {
    await signedInUser(context, { label: "cn" });
    await openTab(page, "Share");
    const card = page.getByRole("region", { name: NEW_FOOTER_LABEL, exact: true });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(NEW_FOOTER_LABEL);
    const link = card.getByRole("link", { name: "See how to connect" });
    // An absolute link to the marketing host (the editor is on the app host), in a new tab.
    await expect(link).toHaveAttribute("href", url(null, "/connect"));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await request.get(url(null, "/connect"))).status()).toBe(200);
    // It is the last card of the Share tab, and the cards before it are where they were.
    const headings = await page
      .getByRole("tabpanel")
      .getByRole("heading", { level: 2 })
      .allTextContents();
    expect(headings.slice(0, 6)).toEqual([
      "Your page address",
      "Redirect mode",
      "Share card",
      "Link tracking",
      "QR code",
      "Private preview links",
    ]);
    expect(headings[headings.length - 1]).toBe(NEW_FOOTER_LABEL);
    await expectNoHorizontalScroll(page);
  });
});
