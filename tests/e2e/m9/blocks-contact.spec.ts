import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, phoneOnly, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { DEV_PORT, expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  addBlock,
  box,
  draftOf,
  expectDraft,
  openEditor,
  previewScreen,
  rowOf,
  showView,
  userWithDraft,
} from "../m2/blocks-helpers";
import {
  DESKTOP_UA,
  HEADLESS_UA,
  eventsOf,
  ingestPage,
  randomIp,
  settledCount,
  waitForClicks,
} from "../m4/analytics-ingest-helpers";
import { unfoldVcard, vcardFor, VCARD_PROPERTIES } from "@/lib/contact/vcard";
import type { Block } from "@/lib/document";
import {
  outerOf,
  publishFromEditor,
  publishedOf,
  settled,
  trackDialogs,
} from "./blocks-fcd-helpers";

/**
 * M9-17 and M9-18 on a real page: the contact block as the live page draws it, the "Save contact"
 * download, the /c/<pageId>/<blockId> route (raw HTTP: status, headers, body, hosts, counting,
 * limits), the editor form, and the abuse cases through the owner's own JWT.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const CONTACT_ID = "contact-blk-live1";

/** A 60-character name, a 30-character phone, a 254-character email and four lines of hours. */
const NAME = "Mara Okafor-Lindqvist, Portrait & Studio Photographer Ltd"
  .slice(0, 60)
  .padEnd(60, "x");
const PHONE = "+1 (555) 123-4567 ------------";
const EMAIL =
  `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(9)}`.slice(
    0,
    254,
  );
const HOURS =
  "Mon to Fri, 9am to 5pm\nSat, by appointment only\nSun, closed\nBank holidays, closed";

function contact(extra: Record<string, unknown> = {}): Block {
  return {
    id: CONTACT_ID,
    type: "contact",
    visible: true,
    name: "Mara Okafor",
    phone: "+1 (555) 123-4567",
    email: "hello@maraokafor.example",
    hours: "Mon to Fri, 9am to 5pm\nSat, by appointment",
    ...extra,
  } as Block;
}

const link: Block = {
  id: "link-ctc-00001",
  type: "link",
  visible: true,
  label: "Book a session",
  url: "https://maraokafor.example/book",
};

test.describe("M9-17 the live page", () => {
  test("M9-17 the longest values wrap inside the column, and the phone, email and Save contact are 44px tall", async ({
    page,
  }, info) => {
    expect(PHONE).toHaveLength(30);
    expect(EMAIL).toHaveLength(254);
    const p = await ingestPage("ct1", {
      blocks: [contact({ name: NAME, phone: PHONE, email: EMAIL, hours: HOURS }), link],
    });
    await page.goto(p.url);
    await settled(page);
    await expectNoHorizontalScroll(page);
    const block = page.locator(`[data-block-id="${CONTACT_ID}"]`);
    const column = await box(page.locator("main"));
    const blockBox = await box(block);
    expect(blockBox.x + blockBox.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
    for (const selector of [
      ".pg-contact-name",
      ".pg-contact-phone",
      ".pg-contact-email",
      ".pg-contact-hours",
      ".pg-contact-save",
    ]) {
      const b = await box(block.locator(selector));
      expect(b.x, selector).toBeGreaterThanOrEqual(blockBox.x - 0.5);
      expect(b.x + b.width, selector).toBeLessThanOrEqual(blockBox.x + blockBox.width + 0.5);
    }
    for (const selector of [".pg-contact-phone", ".pg-contact-email", ".pg-contact-save"]) {
      expect((await box(block.locator(selector))).height, selector).toBeGreaterThanOrEqual(43.5);
    }
    // The hours keep their four lines.
    const hours = await block.locator(".pg-contact-hours").evaluate((el) => ({
      white: getComputedStyle(el).whiteSpace,
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(hours.white).toBe("pre-line");
    expect(hours.height).toBeGreaterThanOrEqual(hours.lineHeight * 4 - 1);
    await expectTapTargets(page);

    if (desktopOnly(info)) {
      expect(blockBox.width).toBeLessThanOrEqual(480);
      expect(blockBox.width).toBeGreaterThan(300);
    } else {
      expect(blockBox.width).toBeLessThanOrEqual(390);
    }
  });

  test("M9-17 the phone and email are tel: and mailto: links, Save contact is a relative download link, and the page holds no other copy of them", async ({
    page,
  }) => {
    const p = await ingestPage("ct2", { blocks: [contact(), link] });
    await page.goto(p.url);
    await settled(page);
    const block = page.locator(`[data-block-id="${CONTACT_ID}"]`);
    await expect(block.locator(".pg-contact-name")).toHaveText("Mara Okafor");
    await expect(block.locator(".pg-contact-phone")).toHaveAttribute("href", "tel:+15551234567");
    await expect(block.locator(".pg-contact-phone")).toHaveText("+1 (555) 123-4567");
    await expect(block.locator(".pg-contact-email")).toHaveAttribute(
      "href",
      "mailto:hello@maraokafor.example",
    );
    const save = block.locator(".pg-contact-save");
    await expect(save).toHaveAttribute("href", `/c/${p.pageId}/${CONTACT_ID}`);
    await expect(save).toHaveAttribute("download", "");
    await expect(save).toHaveText("Save contact");
    // The phone and email links are not tracked: they do not go through /r.
    expect(await block.locator("a[href*='/r/']").count()).toBe(0);
    // The live page's HTML holds the address and the number only in the block's own anchors.
    const html = await (await page.request.get(p.url)).text();
    expect(html.split("hello@maraokafor.example").length - 1).toBe(2);
    expect(html.split("+15551234567").length - 1).toBe(1);
    expect(html.split("+1 (555) 123-4567").length - 1).toBe(1);
  });

  test("M9-17 a name that is markup renders as text, and a hidden contact block's data is nowhere on the page or in any response", async ({
    page,
  }) => {
    const dialogs = trackDialogs(page);
    const hidden: Block = contact({
      id: "contact-hidden-01",
      visible: false,
      name: "HIDDEN-NAME-SECRET",
      phone: "+1 555 000 9999",
      email: "hidden-secret@example.test",
      hours: "HIDDEN-HOURS-SECRET",
    });
    const p = await ingestPage("ct3", {
      blocks: [contact({ name: "<img src=x onerror=alert(1)>" }), hidden],
    });
    await page.goto(p.url);
    await settled(page);
    await expect(page.locator(".pg-contact-name")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(page.locator(".pg-contact img")).toHaveCount(0);
    const html = await page.content();
    for (const secret of [
      "HIDDEN-NAME-SECRET",
      "hidden-secret@example.test",
      "HIDDEN-HOURS-SECRET",
      "5550009999",
    ]) {
      expect(html).not.toContain(secret);
    }
    const route = await rawRequest(p.host, `/c/${p.pageId}/contact-hidden-01`, {
      headers: { "x-forwarded-for": randomIp(), "user-agent": DESKTOP_UA },
    });
    expect(route.status).toBe(404);
    expect(route.body).not.toContain("HIDDEN-NAME-SECRET");
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test("M9-18 Save contact downloads {slug}.vcf with the stored fields, and the click is counted under the block's id", async ({
    page,
    context,
  }) => {
    const p = await ingestPage("ct4", { blocks: [contact({ name: "José Álvarez" }), link] });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url);
    await settled(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".pg-contact-save").click(),
    ]);
    expect(download.suggestedFilename()).toBe("jose-alvarez.vcf");
    const path = await download.path();
    const text = readFileSync(path, "utf8");
    expect(text).toBe(
      vcardFor(
        {
          name: "José Álvarez",
          phone: "+1 (555) 123-4567",
          email: "hello@maraokafor.example",
          hours: "Mon to Fri, 9am to 5pm\nSat, by appointment",
        },
        `http://${p.host}/`,
      ),
    );
    const lines = unfoldVcard(text);
    expect(lines).toContain("FN:José Álvarez");
    expect(lines).toContain("N:Álvarez;José;;;");
    expect(lines).toContain("TEL;TYPE=VOICE:+15551234567");
    expect(lines).toContain("EMAIL;TYPE=INTERNET:hello@maraokafor.example");
    expect(lines).toContain(`URL:http://${p.host}/`);
    expect(lines).toContain("NOTE:Mon to Fri\\, 9am to 5pm\\nSat\\, by appointment");
    const clicks = await waitForClicks(p.pageId, 1);
    expect(clicks.map((c) => c.block_id)).toEqual([CONTACT_ID]);
    // The page itself stayed where it was: a download is not a navigation.
    expect(page.url()).toBe(p.url);
  });
});

test.describe("M9-18 with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("M9-18 pressing Save contact still downloads the card", async ({ page, context }) => {
    const p = await ingestPage("ct5", { blocks: [contact(), link] });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url);
    await expect(page.locator(".pg-contact-phone")).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".pg-contact-save").click(),
    ]);
    expect(download.suggestedFilename()).toBe("mara-okafor.vcf");
    expect(readFileSync(await download.path(), "utf8")).toContain("BEGIN:VCARD\r\nVERSION:3.0\r\n");
  });
});

// The route, raw HTTP ----------------------------------------------------------------------------------------

test.describe("M9-18 GET /c/<pageId>/<blockId>", () => {
  const get = (host: string, path: string, headers: Record<string, string> = {}, method = "GET") =>
    rawRequest(host, path, {
      method,
      headers: { "x-forwarded-for": randomIp(), "user-agent": DESKTOP_UA, ...headers },
    });

  test("M9-18 200 with the file and every hardening header; the query, Host, Referer and cookies change nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("cr1", { blocks: [contact(), link] });
    const path = `/c/${p.pageId}/${CONTACT_ID}`;
    const res = await get(p.host, path);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/vcard; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="mara-okafor.vcf"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.setCookies).toEqual([]);
    expect(res.body).toBe(
      vcardFor(
        {
          name: "Mara Okafor",
          phone: "+1 (555) 123-4567",
          email: "hello@maraokafor.example",
          hours: "Mon to Fri, 9am to 5pm\nSat, by appointment",
        },
        `http://${p.host}/`,
      ),
    );
    const names = unfoldVcard(res.body).map((line) => line.split(/[:;]/, 1)[0]!);
    for (const name of names) expect(VCARD_PROPERTIES as readonly string[]).toContain(name);

    for (const variant of [
      get(p.host, `${path}?name=Evil&download=x.exe&FN=Evil`),
      get(p.host, path, {
        referer: "https://evil.example/?name=Evil",
        cookie: "name=Evil; session=1",
      }),
      get(p.host, path, { "x-forwarded-host": "evil.example", origin: "https://evil.example" }),
      get(p.host, path, { "accept-language": "ja" }),
    ]) {
      const other = await variant;
      expect(other.status).toBe(200);
      expect(other.body).toBe(res.body);
      expect(other.headers["content-disposition"]).toBe(res.headers["content-disposition"]);
      expect(other.setCookies).toEqual([]);
    }
  });

  test("M9-18 HEAD answers the same headers with no body and records nothing; other methods are 405 with Allow", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("cr2", { blocks: [contact()] });
    const path = `/c/${p.pageId}/${CONTACT_ID}`;
    const head = await get(p.host, path, {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("text/vcard; charset=utf-8");
    expect(head.body).toBe("");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = await get(p.host, path, {}, method);
      expect(res.status, method).toBe(405);
      expect(res.headers.allow, method).toBe("GET, HEAD");
    }
    expect(await settledCount(p.pageId)).toBe(0);
  });

  test("M9-18 a draft-only block, a hidden one, an unknown id, another block type, another page's block and an unpublished page are the 404 notice and record nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("cr3", {
      blocks: [contact(), contact({ id: "contact-hidden-02", visible: false }), link],
      draft: draftOf("x", [contact({ id: "contact-draft-001", name: "Draft Only" })]),
    });
    const other = await ingestPage("cr4", {
      blocks: [contact({ id: "contact-other-001", name: "Someone Else" })],
    });
    const unpublished = await ingestPage("cr5", {
      published: false,
      draft: draftOf("y", [contact({ id: "contact-unpub-001" })]),
    });
    const cases: [string, string, string][] = [
      ["draft only", p.pageId, "contact-draft-001"],
      ["hidden", p.pageId, "contact-hidden-02"],
      ["unknown id", p.pageId, "contact-nothing-1"],
      ["another type", p.pageId, link.id],
      ["another page's block", p.pageId, "contact-other-001"],
      ["a block of another page, on this page's id", other.pageId, CONTACT_ID],
      ["unpublished", unpublished.pageId, "contact-unpub-001"],
      ["not a uuid", "not-a-uuid", CONTACT_ID],
      ["bad block id", p.pageId, "bad id!"],
    ];
    for (const [name, pageId, blockId] of cases) {
      const host = pageId === unpublished.pageId ? unpublished.host : p.host;
      const res = await get(host, `/c/${pageId}/${encodeURIComponent(blockId)}`);
      expect(res.status, name).toBe(404);
      expect(res.headers["content-type"], name).toContain("text/html");
      expect(res.headers["cache-control"], name).toBe("no-store");
      expect(res.body, name).toContain("Go to hydlnk.com");
      expect(res.body, name).not.toContain("BEGIN:VCARD");
      expect(res.body, name).not.toContain("Draft Only");
      expect(res.setCookies, name).toEqual([]);
    }
    for (const id of [p.pageId, other.pageId, unpublished.pageId])
      expect(await settledCount(id, 300)).toBe(0);
  });

  test("M9-18 only a page's own hosts serve it; a verified custom host puts the custom domain in URL:", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("cr6", { blocks: [contact()], plan: "studio" });
    const victim = await ingestPage("cr7", {
      blocks: [contact({ id: "contact-victim-01" })],
      plan: "pro",
    });
    const hostname = `links-${rand(6)}.example.test`;
    const victimHost = `victim-${rand(6)}.example.test`;
    const pending = `pending-${rand(6)}.example.test`;
    const verifiedAt = new Date().toISOString();
    for (const [page, host, status] of [
      [p, hostname, "verified"],
      [victim, victimHost, "verified"],
      [p, pending, "pending"],
    ] as const) {
      const added = await adminClient()
        .from("domains")
        .insert({
          page_id: page.pageId,
          hostname: host,
          status,
          verified_at: status === "verified" ? verifiedAt : null,
        });
      expect(added.error?.message).toBeUndefined();
    }
    const path = `/c/${p.pageId}/${CONTACT_ID}`;
    // The custom domain is the page's public address once one is verified.
    const custom = await get(`${hostname}:${DEV_PORT}`, path);
    expect(custom.status).toBe(200);
    const customLines = unfoldVcard(custom.body);
    expect(customLines.find((line) => line.startsWith("URL:"))).toMatch(
      new RegExp(`^URL:https?://${hostname}(:\\d+)?/$`),
    );
    // The handle host serves the same card, with the same URL: line (decided on the server, not by the Host header).
    const handle = await get(p.host, path);
    expect(handle.status).toBe(200);
    expect(handle.body).toBe(custom.body);

    for (const host of [
      victim.host,
      victimHost,
      `${victimHost}:${DEV_PORT}`,
      pending,
      `localhost:${DEV_PORT}`,
      `app.localhost:${DEV_PORT}`,
      "unknown-host.example.test",
    ]) {
      const res = await get(host, path);
      expect(res.status, host).toBe(404);
      expect(res.body, host).not.toContain("BEGIN:VCARD");
    }
    const forwarded = await get(victimHost, path, {
      "x-forwarded-host": p.host,
      "x-original-host": p.host,
    });
    expect(forwarded.status).toBe(404);
  });

  test("M9-18 a navigation or a download records one click row under the block's id; a bot, a HEAD and an <img> do not", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("cr8", { blocks: [contact(), link] });
    const path = `/c/${p.pageId}/${CONTACT_ID}`;
    const ip = randomIp();
    for (const dest of [undefined, "document", "empty"]) {
      const res = await get(p.host, path, {
        "x-forwarded-for": ip,
        ...(dest ? { "sec-fetch-dest": dest } : {}),
      });
      expect(res.status).toBe(200);
    }
    const clicks = await waitForClicks(p.pageId, 3);
    expect(clicks.every((row) => row.block_id === CONTACT_ID && row.type === "click")).toBe(true);
    expect(clicks.every((row) => row.referrer === null)).toBe(true);
    const before = (await eventsOf(p.pageId)).length;
    await get(p.host, path, { "x-forwarded-for": ip, "user-agent": HEADLESS_UA });
    await get(p.host, path, {
      "x-forwarded-for": ip,
      "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    });
    await get(p.host, path, { "x-forwarded-for": ip, "sec-fetch-dest": "image" });
    await get(p.host, path, { "x-forwarded-for": ip, "sec-fetch-dest": "iframe" });
    await get(p.host, path, { "x-forwarded-for": ip }, "HEAD");
    expect(await settledCount(p.pageId)).toBe(before);
  });

  test("M9-18 more than 30 downloads a minute from one client is 429 with Retry-After and the notice page", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("cr9", { blocks: [contact()] });
    const ip = randomIp();
    const path = `/c/${p.pageId}/${CONTACT_ID}`;
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++)
      statuses.push(
        (await get(p.host, path, { "x-forwarded-for": ip, "user-agent": HEADLESS_UA })).status,
      );
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
    const blocked = await get(p.host, path, { "x-forwarded-for": ip });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(blocked.body).toContain("Too many downloads");
    expect(blocked.body).not.toContain("BEGIN:VCARD");
    // Another client is not affected.
    expect((await get(p.host, path, { "x-forwarded-for": randomIp() })).status).toBe(200);
  });

  test("M9-18 fifty invented /c/<uuid>/<id> requests are the 404 notice, dynamic and never cached", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("cr10", { blocks: [contact()] });
    const uuid = () =>
      `${rand(8)}-${rand(4)}-${rand(4)}-${rand(4)}-${rand(12)}`.replace(/[^0-9a-f-]/g, "a");
    for (let i = 0; i < 50; i++) {
      const res = await get(p.host, `/c/${uuid()}/${rand(8)}`);
      expect(res.status).toBe(404);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-nextjs-cache"]).toBeUndefined();
    }
    expect(await settledCount(p.pageId, 300)).toBe(0);
  });
});

test.describe("M9-18 the notice pages", () => {
  test("M9-18 the 404 notice wraps its message, its link is 44px tall and the page does not scroll sideways; on a desktop it is centered and at most 440px wide", async ({
    page,
    context,
  }, info) => {
    const p = await ingestPage("cn1", { blocks: [contact()] });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    const response = await page.goto(`${p.url}c/${p.pageId}/contact-nothing-1`);
    expect(response!.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Go to hydlnk.com" })).toBeVisible();
    expect(
      (await box(page.getByRole("link", { name: "Go to hydlnk.com" }))).height,
    ).toBeGreaterThanOrEqual(43.5);
    await expectNoHorizontalScroll(page);
    const main = await box(page.locator("main"));
    if (desktopOnly(info)) {
      expect(main.width).toBeLessThanOrEqual(440.5);
      const viewport = page.viewportSize()!.width;
      expect(Math.abs(main.x + main.width / 2 - viewport / 2)).toBeLessThanOrEqual(2);
    } else {
      expect(main.width).toBeLessThanOrEqual(390);
    }
  });

  test("M9-18 the 429 notice looks the same", async ({ page, context }, info) => {
    const p = await ingestPage("cn2", { blocks: [contact()] });
    const ip = randomIp();
    for (let i = 0; i < 31; i++) {
      await rawRequest(p.host, `/c/${p.pageId}/${CONTACT_ID}`, {
        headers: { "x-forwarded-for": ip, "user-agent": HEADLESS_UA },
      });
    }
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    const response = await page.goto(`${p.url}c/${p.pageId}/${CONTACT_ID}`);
    expect(response!.status()).toBe(429);
    await expect(page.getByText("Too many downloads from your network.")).toBeVisible();
    expect(
      (await box(page.getByRole("link", { name: "Go to hydlnk.com" }))).height,
    ).toBeGreaterThanOrEqual(43.5);
    await expectNoHorizontalScroll(page);
    if (desktopOnly(info))
      expect((await box(page.locator("main"))).width).toBeLessThanOrEqual(440.5);
  });
});

// The editor ---------------------------------------------------------------------------------------------------

test.describe("M9-17 the editor", () => {
  test("M9-17 the form: four fields, counters, 44px and 16px inputs, the right keyboards, inline errors as you type, and the draft saves anyway", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "ce1");
    await openEditor(page);
    const { row, panel } = await addBlock(page, "contact");
    const name = panel.getByLabel("Name", { exact: true });
    const phone = panel.getByLabel("Phone", { exact: true });
    const email = panel.getByLabel("Email", { exact: true });
    const hours = panel.getByLabel("Hours", { exact: true });
    await expect(phone).toHaveAttribute("type", "tel");
    await expect(phone).toHaveAttribute("inputmode", "tel");
    await expect(email).toHaveAttribute("type", "email");
    await expect(panel).toContainText("0 / 60");
    await expect(panel).toContainText("0 / 160");

    for (const field of [name, phone, email, hours]) {
      expect((await box(field)).height).toBeGreaterThanOrEqual(43.5);
      expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    }
    await name.fill("Mara Okafor");
    await expect(row).toContainText("Mara Okafor");
    await expect(panel).toContainText("11 / 60");

    // Errors show as the person types, and the draft saves anyway.
    await phone.fill("javascript:alert(1)");
    await expect(
      panel.getByText("Enter a valid phone number, like +1 555 123 4567."),
    ).toBeVisible();
    await email.fill("a@b.example,c@d.example");
    await expect(panel.getByText("Enter a valid email address.")).toBeVisible();
    await expectDraft(user.pageId, (d) => JSON.stringify(d).includes("javascript:alert(1)"));
    await phone.fill("+1 (555) 123-4567");
    await expect(panel.getByText("Enter a valid phone number, like +1 555 123 4567.")).toHaveCount(
      0,
    );
    await expect(row).toContainText("Phone");
    await email.fill("hello@maraokafor.example");
    await expect(row).toContainText("Phone and email");
    await hours.fill("Mon to Fri\nSat");
    await expect(panel).toContainText("14 / 160");
    await expectNoHorizontalScroll(page);
    const b = await box(panel);
    expect(b.width).toBeLessThanOrEqual(phoneOnly(info) ? 390 : 720);
    // One Color control in the style group.
    await expect(
      panel.getByTestId("override-controls").getByText("Color", { exact: true }).first(),
    ).toBeVisible();
  });

  test("M9-17 Publish names each field: the name, and 'Add a phone number or an email address.' under Phone; the row opens and focuses the first", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ce2", (handle) =>
      draftOf(handle, [contact({ name: "", phone: "", email: "" })]),
    );
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "before publishing" })).toBeVisible();
    const panel = rowOf(page, CONTACT_ID);
    await expect(panel.getByText("Add a name.")).toBeVisible();
    await expect(panel.getByText("Add a phone number or an email address.")).toBeVisible();
    await expect(panel.getByLabel("Name", { exact: true })).toBeFocused();
    expect((await publishedOf(user.pageId)).published).toBeNull();
    await panel.getByLabel("Name", { exact: true }).fill("Mara");
    await panel.getByLabel("Email", { exact: true }).fill("a@b.example");
    await expect(panel.getByText("Add a phone number or an email address.")).toHaveCount(0);
  });

  test("M9-17 after Publish the live block is the preview's, link for link", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "ce3", (handle) =>
      draftOf(handle, [contact(), { ...link, id: "link-ctc-00002" }]),
    );
    await openEditor(page);
    await showView(page, "Preview");
    const preview = previewScreen(page);
    await expect(
      preview.locator(`[data-block-id="${CONTACT_ID}"] .pg-contact-save`),
    ).toHaveAttribute("href", `/c/${user.pageId}/${CONTACT_ID}`);
    const inEditor = await outerOf(preview, CONTACT_ID);
    await showView(page, "Blocks");
    await publishFromEditor(page, user.pageId);
    await page.goto(url(user.handle));
    await settled(page);
    expect(await outerOf(page.locator("body"), CONTACT_ID)).toBe(inEditor);
    if (desktopOnly(info)) {
      await expect(page.locator(".pg-contact-phone")).toHaveAttribute("href", "tel:+15551234567");
    }
  });
});

// Abuse through the owner's JWT and the publishable key ----------------------------------------------------------

test.describe("M9-17 the abuse cases", () => {
  test("M9-17 a javascript: phone, a mailto-with-bcc and a two-address email, and a control character in the name are refused at Publish, never published and never an anchor", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ca1");
    const client = userClient(await accessTokenFor(user.email));
    const draft = draftOf(user.handle, [
      contact({ id: "contact-bad-phone1", phone: "javascript:alert(1)", email: "" }),
      contact({
        id: "contact-bad-mail1",
        phone: "",
        email: "a@b.example?subject=x&bcc=y@evil.example",
      }),
      contact({ id: "contact-bad-mail2", phone: "", email: "a@b.example,c@d.example" }),
      contact({ id: "contact-bad-name1", name: "Mara\u0007Okafor" }),
      contact({ id: "contact-bad-tel-2", phone: "tel:+1555@evil.example", email: "" }),
    ]);
    const write = await client.from("pages").update({ draft }).eq("id", user.pageId);
    expect(write.error).toBeNull();
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Fix 5 blocks before publishing.");
    expect(await publishedOf(user.pageId)).toEqual({ published: null, published_at: null });
    const body = await (await page.request.get(url(user.handle))).text();
    for (const text of ["pg-contact", "javascript:", "evil.example", "bcc=", "tel:"])
      expect(body).not.toContain(text);
  });

  test("M9-17 a hidden contact block with bad fields does not stop Publish and leaves nothing behind", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ca2");
    const client = userClient(await accessTokenFor(user.email));
    const write = await client
      .from("pages")
      .update({
        draft: draftOf(user.handle, [
          contact({
            id: "contact-hidden-03",
            visible: false,
            phone: "javascript:alert(1)",
            email: "x",
            name: "",
          }),
          { id: "header-ctc-00001", type: "header", visible: true, text: "Hello" },
        ]),
      })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();
    await openEditor(page);
    await publishFromEditor(page, user.pageId);
    const stored = JSON.stringify((await publishedOf(user.pageId)).published);
    expect(stored).not.toContain("contact-hidden-03");
    expect(stored).not.toContain("javascript:");
  });
});
