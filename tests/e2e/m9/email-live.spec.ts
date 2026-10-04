import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { appRaw, rawRequest } from "../fixtures/http";
import { MAILPIT, messagesTo, waitForMessages } from "../fixtures/mailpit";
import { requireLocalEnv } from "../fixtures/stripe-stub";
import { markDnsReady } from "../fixtures/vercel-stub";
import { addDomainRow, domainRowOf, hostnameFor, makeSite } from "../m4/domains-core-helpers";
import { liveEmailContent } from "@/lib/domains/live-email";

/**
 * M9-09: the "your domain is live" email, rebuilt with react-email. One flow end to end against the
 * local Mailpit (the M5-23 flow with the Vercel stub: the five-minute sweep verifies a domain and the
 * owner gets one message), and the HTML part drawn in a phone and a desktop viewport.
 */

test.afterAll(cleanupUsers);

const SWEEP = "/api/cron/verify-domains";
const SECRET = () => requireLocalEnv("CRON_SECRET");

test.describe("M9-09 the message Mailpit receives", () => {
  test.describe.configure({ timeout: 120_000 });

  test("M9-09 verifying a custom domain delivers one message with both parts, from HYDLNK, and a repeat poll sends no second one", async ({}, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const site = await makeSite("ml9");
    const host = hostnameFor("ml9");
    const id = await addDomainRow({ pageId: site.pageId, hostname: host, status: "pending" });
    await markDnsReady(host);

    const sweep = () => appRaw(SWEEP, { method: "POST", headers: { authorization: `Bearer ${SECRET()}` } });
    expect((await sweep()).status).toBe(200);
    expect((await domainRowOf(id))!.status).toBe("verified");

    const mail = await waitForMessages(site.user.email, 1);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.Subject).toBe(`${host} is live`);

    const response = await fetch(`${MAILPIT}/api/v1/message/${mail[0]!.ID}`);
    const full = (await response.json()) as {
      From: { Address: string; Name: string };
      To: { Address: string }[];
      Subject: string;
      HTML: string;
      Text: string;
    };
    expect(full.From).toEqual({ Address: "hello@hydlnk.com", Name: "HYDLNK" });
    expect(full.To.map((t) => t.Address.toLowerCase())).toEqual([site.user.email.toLowerCase()]);
    // Both parts are there and non-empty, with the words of M5-23.
    expect(full.HTML.trim().length).toBeGreaterThan(100);
    expect(full.Text.trim().length).toBeGreaterThan(20);
    const sentence = `Your page is now served at https://${host}.`;
    for (const part of [full.HTML, full.Text]) {
      expect(part.split(sentence).length - 1).toBe(1);
      expect(part).toContain(`Open ${host}`);
    }
    expect(full.HTML).toContain(`href="https://${host}/"`);
    expect((full.HTML.match(/<a\s/g) ?? []).length).toBe(1);
    expect(full.Text).not.toContain("!");
    expect(full.HTML).not.toMatch(/<(img|script|link|style)[\s>]/i);

    // A repeat poll of the verified domain sends nothing more.
    await sweep();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await messagesTo(site.user.email)).toHaveLength(1);
  });

  test("M9-09 the route is unchanged on other hosts: the sweep is a 404 on a tenant host", async ({}, info) => {
    test.skip(!desktopOnly(info), "an HTTP data flow: one project is enough");
    const res = await rawRequest("mara.localhost:3000", SWEEP, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET()}` },
    });
    expect(res.status).toBe(404);
  });
});

/** The HTML part as a message viewer draws it: no network, the document set into a blank page. */
async function openHtml(page: Page): Promise<void> {
  const { html } = await liveEmailContent("links.example.test");
  await page.setContent(html, { waitUntil: "load" });
}

test.describe("M9-09 the HTML part in a viewport", () => {
  test("M9-09 at 390x844 there is no horizontal scroll, the link is at least 44px tall and the container is at most 480px wide", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "the phone viewport");
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    await openHtml(page);
    const scroll = await page.evaluate(() => ({
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      innerWidth: window.innerWidth,
    }));
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.innerWidth);
    const link = page.getByRole("link", { name: "Open links.example.test" });
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const container = await link.evaluate((anchor) => {
      const table = anchor.closest("table");
      return table ? table.getBoundingClientRect().width : -1;
    });
    expect(container).toBeGreaterThan(0);
    expect(container).toBeLessThanOrEqual(480);
    await expect(page.getByText("Your page is now served at https://links.example.test.")).toBeVisible();
  });

  test("M9-09 at 1440x900 it is one readable column and the link is visible without scrolling", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the desktop viewport");
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
    await openHtml(page);
    const sentence = page.getByText("Your page is now served at https://links.example.test.");
    const link = page.getByRole("link", { name: "Open links.example.test" });
    await expect(link).toBeInViewport({ ratio: 1 });
    const [s, l] = [(await sentence.boundingBox())!, (await link.boundingBox())!];
    // One column: both start at the same left edge, the link is under the sentence, and the column is narrow.
    expect(Math.abs(s.x - l.x)).toBeLessThanOrEqual(1);
    expect(l.y).toBeGreaterThan(s.y);
    expect(s.width).toBeLessThanOrEqual(480);
    const scroll = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
    expect(scroll).toBe(true);
  });
});
