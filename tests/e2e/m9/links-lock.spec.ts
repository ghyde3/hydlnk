import { randomBytes, scryptSync } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { normalizeLockCode, type Block } from "@/lib/document";
import {
  IPHONE_UA,
  docOf,
  expectNoDestination,
  getClick,
  getPage,
  link,
  livePage,
  postClick,
  randomIp,
  settledClicks,
  startStub,
  waitForClicks,
  type Stub,
} from "./links-helpers";

/**
 * M9-29 the gate of a locked link at /r/ and M9-30 its mark on the live page, end to end: the
 * interstitial and its headers, passing it (a 303 and one click row), the refusals (wrong code,
 * cross-site, content type, size, unlocked link, draft-only id), the limits (6 wrong tries end in
 * 429; 20 parallel tries evaluate at most 5), the destination never leaking, the page's marker, and
 * the whole flow in a browser, with JavaScript off, on both viewports.
 */

test.afterAll(async () => {
  await cleanupUsers();
});
test.describe.configure({ timeout: 120_000 });

const CODE = "Spring2026";
const SECRET_HOST = "secret.example";
const DEST = `https://${SECRET_HOST}/vault?id=1`;

const ID = {
  age: "lnkage000001",
  code: "lnkcode00001",
  plain: "lnkplain0001",
  other: "lnkother0001",
};

/** What `hashLinkCode` produces, computed here with the documented parameters (N 16384, r 8, p 1, 32 bytes). */
function lockOf(code = CODE): { kind: "code"; salt: string; hash: string } {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizeLockCode(code), salt, 32, { N: 16384, r: 8, p: 1 });
  return { kind: "code", salt: salt.toString("base64url"), hash: hash.toString("base64url") };
}

function lockedBlocks(destination = DEST): { blocks: Block[]; lock: ReturnType<typeof lockOf> } {
  const lock = lockOf();
  return {
    lock,
    blocks: [
      link(ID.age, destination, { lock: { kind: "age" }, label: "Sensitive gallery" }),
      link(ID.code, destination, { lock }),
      link(ID.plain, `https://${SECRET_HOST}/open`),
    ],
  };
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

async function setup(label: string, destination = DEST) {
  const { blocks, lock } = lockedBlocks(destination);
  const live = await livePage(label, docOf(blocks));
  return { live, lock };
}

test.describe("M9-29 the interstitial", () => {
  test("M9-29 GET and HEAD of a locked link answer 200 with the interstitial, its headers and no destination anywhere", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live, lock } = await setup("lk1");
    for (const [id, words] of [
      [ID.age, ["This link may contain sensitive content.", "Continue?"]],
      [ID.code, ["This link is locked.", "Enter the code to continue."]],
    ] as const) {
      const get = await getClick(live, id);
      expect(get.status, id).toBe(200);
      expect(get.location).toBeNull();
      for (const word of words) expect(get.body).toContain(word);
      expect(get.body).toContain(">Continue</button>");
      expect(get.body).toContain('<a class="back" href="/">Go back</a>');
      expect(get.body).toContain(`<form method="post" action="/r/${live.pageId}/${id}">`);
      expect(get.headers["cache-control"]).toBe("no-store");
      expect(get.headers["x-robots-tag"]).toBe("noindex");
      expect(get.headers["referrer-policy"]).toBe("no-referrer");
      expect(get.headers["x-frame-options"]).toBe("DENY");
      expect(get.headers["content-security-policy"]).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      );
      expect(get.setCookies).toEqual([]);
      expectNoDestination(get, SECRET_HOST, lock.salt, lock.hash);

      const head = await getClick(live, id, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.body).toBe("");
      expect(head.headers["content-security-policy"]).toBe(get.headers["content-security-policy"]);
      expectNoDestination(head, SECRET_HOST);

      // A query string with the answer in it is ignored: the interstitial is shown again.
      const ignored = await getClick(live, id, {
        query: `?code=${CODE}&confirm=1&to=https://evil.example`,
      });
      expect(ignored.status).toBe(200);
      expect(ignored.location).toBeNull();
    }
    const code = await getClick(live, ID.code);
    expect(code.body).toContain('name="code"');
    expect(code.body).toContain('autocomplete="off"');
    expect(code.body).toContain('autocapitalize="off"');
    expect(code.body).toContain('spellcheck="false"');
    expect(code.body).toContain('type="text"');
    // No click row for any of it, and a bot sees the same page and never the destination.
    const bot = await getClick(live, ID.code, {
      ua: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    });
    expect(bot.status).toBe(200);
    expectNoDestination(bot, SECRET_HOST);
    expect(await settledClicks(live.pageId)).toBe(0);
  });

  test("M9-29 an unlocked link on the same page still redirects, and the page's own markup holds no destination or hash", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live, lock } = await setup("lk2");
    const plain = await getClick(live, ID.plain);
    expect(plain.status).toBe(302);
    expect(plain.location).toBe(`https://${SECRET_HOST}/open`);
    const html = (await getPage(live.host, { ua: IPHONE_UA })).body;
    expect(html).not.toContain(lock.salt);
    expect(html).not.toContain(lock.hash);
    expect(html).not.toContain("vault");
    expect(html).toContain(`href="/r/${live.pageId}/${ID.code}"`);
    expect(html).toContain('data-locked="code"');
    expect(html).toContain('data-locked="age"');
  });
});

test.describe("M9-29 passing the lock", () => {
  test("M9-29 an age lock: confirm=1 answers 303 to exactly the published URL, no-store, no cookie, and one click row", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live } = await setup("lk3");
    const missing = await postClick(live, ID.age, "");
    expect(missing.status).toBe(400);
    expect(missing.location).toBeNull();
    const passed = await postClick(live, ID.age, form({ confirm: "1" }));
    expect(passed.status).toBe(303);
    expect(passed.location).toBe(DEST);
    expect(passed.headers["cache-control"]).toBe("no-store");
    expect(passed.setCookies).toEqual([]);
    const rows = await waitForClicks(live.pageId, 1);
    expect(rows.map((row) => row.block_id)).toEqual([ID.age]);
    expect(await settledClicks(live.pageId)).toBe(1);
  });

  test("M9-29 a code lock: the right code (any case, with spaces around) opens it; a wrong or missing one does not and records nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live, lock } = await setup("lk4");
    const wrong = await postClick(live, ID.code, form({ code: "nope-nope" }));
    expect(wrong.status).toBe(403);
    expect(wrong.location).toBeNull();
    expect(wrong.body).toContain("That code didn’t match. Try again.");
    expect(wrong.body).toContain('name="code"');
    expectNoDestination(wrong, SECRET_HOST, lock.salt, lock.hash);

    const missing = await postClick(live, ID.code, form({ other: "1" }));
    expect(missing.status).toBe(400);
    expect(missing.body).toContain("Enter the code.");
    expect(await settledClicks(live.pageId)).toBe(0);

    for (const code of [CODE, CODE.toLowerCase(), `  ${CODE.toUpperCase()}  `]) {
      const ok = await postClick(live, ID.code, form({ code }));
      expect(ok.status, code).toBe(303);
      expect(ok.location).toBe(DEST);
      expect(ok.setCookies).toEqual([]);
    }
    const rows = await waitForClicks(live.pageId, 3);
    expect(rows.map((row) => row.block_id)).toEqual([ID.code, ID.code, ID.code]);
    // A bot that posts the right code is sent on and leaves no row.
    const bot = await postClick(live, ID.code, form({ code: CODE }), {
      ua: "Googlebot/2.1 (+http://www.google.com/bot.html)",
    });
    expect(bot.status).toBe(303);
    expect(await settledClicks(live.pageId)).toBe(3);
  });

  test("M9-29 nothing from the request chooses the destination, and the code is accepted from the body only", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live } = await setup("lk5");
    const ok = await postClick(
      live,
      ID.age,
      form({ confirm: "1", to: "https://evil.example", location: "https://evil.example" }),
      {
        headers: { referer: "https://evil.example/", "x-forwarded-host": "evil.example" },
      },
    );
    expect(ok.location).toBe(DEST);
    const inUrl = await getClick(live, ID.code, { query: `?code=${CODE}` });
    expect(inUrl.status).toBe(200);
    expect(inUrl.location).toBeNull();
  });

  test("M9-29 refuses a POST from another site (403), a body that is not a form (415) or is over 1 KB (413), an unlocked link (405), a draft-only id (404) and another host (404)", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live } = await setup("lk6");
    const body = form({ code: CODE });

    const crossSite: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of crossSite) {
      const refused = await postClick(live, ID.code, body, { headers });
      expect(refused.status, JSON.stringify(headers)).toBe(403);
      expect(refused.location).toBeNull();
    }
    expect(
      (
        await postClick(live, ID.code, JSON.stringify({ code: CODE }), {
          contentType: "application/json",
        })
      ).status,
    ).toBe(415);
    expect((await postClick(live, ID.code, form({ code: "a".repeat(1100) }))).status).toBe(413);

    const unlocked = await postClick(live, ID.plain, form({ confirm: "1" }));
    expect(unlocked.status).toBe(405);
    expect(unlocked.headers.allow).toBe("GET, HEAD");
    expect((await postClick(live, "lnkdraftonly", form({ confirm: "1" }))).status).toBe(404);
    // Another tenant's host and the root host are not this page's.
    const other = await livePage("lk6b", docOf([link(ID.other, "https://example.com/")]));
    expect(
      (await postClick(live, ID.code, body, { host: other.host, origin: other.origin })).status,
    ).toBe(404);
    expect(
      (
        await postClick(live, ID.code, body, {
          host: "localhost:3000",
          origin: "http://localhost:3000",
        })
      ).status,
    ).toBe(404);
    expect(await settledClicks(live.pageId)).toBe(0);
  });
});

test.describe("M9-29 the limits", () => {
  test("M9-29 six wrong tries in a row end in 429 with Retry-After, and the right code is refused while limited", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live } = await setup("lk7");
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await postClick(live, ID.code, form({ code: `wrong-${i}-x` }), { ip })).status,
      );
    }
    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
    const limited = await postClick(live, ID.code, form({ code: CODE }), { ip });
    expect(limited.status).toBe(429);
    expect(limited.location).toBeNull();
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.body).toContain("Too many tries. Wait a minute and try again.");
    // Another client is not held back by this one's tries.
    expect((await postClick(live, ID.code, form({ code: CODE }), { ip: randomIp() })).status).toBe(
      303,
    );
  });

  test("M9-29 twenty parallel wrong tries are decided by at most five checks", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const { live } = await setup("lk8");
    const ip = randomIp();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        postClick(live, ID.code, form({ code: `wrong-${i}-xx` }), { ip }),
      ),
    );
    const checked = responses.filter((response) => response.status === 403).length;
    const limited = responses.filter((response) => response.status === 429).length;
    expect(checked).toBeLessThanOrEqual(5);
    expect(checked + limited).toBe(20);
  });

  test("M9-29 waiting out the window allows the correct code again", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    test.setTimeout(180_000);
    const { live } = await setup("lk9");
    const ip = randomIp();
    for (let i = 0; i < 5; i++)
      await postClick(live, ID.code, form({ code: `wrong-${i}-x` }), { ip });
    expect((await postClick(live, ID.code, form({ code: CODE }), { ip })).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    expect((await postClick(live, ID.code, form({ code: CODE }), { ip })).status).toBe(303);
  });
});

test.describe("M9-30 the locked link in a browser", () => {
  let stub: Stub;
  test.beforeAll(async () => {
    stub = await startStub();
  });
  test.afterAll(async () => {
    await stub.close();
  });

  async function pageWithLocks(label: string, longLabel?: string) {
    const lock = lockOf();
    const destination = stub.url("/vault");
    const live = await livePage(
      label,
      docOf([
        link(ID.age, destination, {
          lock: { kind: "age" },
          label: longLabel ?? "Sensitive gallery",
        }),
        link(ID.code, destination, { lock, label: "Members only" }),
        link(ID.plain, stub.url("/open"), { label: "Open link" }),
      ]),
    );
    return { live, lock };
  }

  test("M9-30 the live page marks a locked link: data-locked, a 16px glyph at the end edge, the label plus hidden words as its name, 44px tall, no destination or hash in the page", async ({
    page,
  }) => {
    const long = "A".repeat(10) + " very long label ".repeat(5) + "end".padEnd(5, "!");
    const { live, lock } = await pageWithLocks("lk10", long.slice(0, 80));
    await page.goto(live.url);
    const age = page.locator(`.pg-link[data-block-id="${ID.age}"]`);
    const code = page.locator(`.pg-link[data-block-id="${ID.code}"]`);
    await expect(age).toHaveAttribute("data-locked", "age");
    await expect(code).toHaveAttribute("data-locked", "code");
    await expect(age).toHaveAttribute("href", `/r/${live.pageId}/${ID.age}`);
    await expect(page.locator(`.pg-link[data-block-id="${ID.plain}"]`)).not.toHaveAttribute(
      "data-locked",
      /.*/,
    );
    // The accessible name is the label plus the hidden words.
    await expect(page.getByRole("link", { name: "Members only (locked)" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: `${long.slice(0, 80).trim()} (sensitive content)` }),
    ).toBeVisible();

    for (const id of [ID.age, ID.code]) {
      const anchor = page.locator(`.pg-link[data-block-id="${id}"]`);
      const box = (await anchor.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      const glyph = anchor.locator("svg.pg-lock-glyph");
      const glyphBox = (await glyph.boundingBox())!;
      expect([Math.round(glyphBox.width), Math.round(glyphBox.height)]).toEqual([16, 16]);
      // At the end edge: the glyph's right side sits within 24px of the button's right side.
      expect(box.x + box.width - (glyphBox.x + glyphBox.width)).toBeLessThan(24);
      expect(box.x + box.width - (glyphBox.x + glyphBox.width)).toBeGreaterThan(0);
      // Without overlapping the text: the label's own box ends before the glyph starts.
      const textRight = await anchor.evaluate((element, glyphLeft) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        let right = 0;
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.left < glyphLeft && rect.width > 1 && rect.height > 1)
            right = Math.max(right, rect.right);
        }
        return right;
      }, glyphBox.x);
      expect(textRight).toBeLessThanOrEqual(glyphBox.x + 0.5);
      await expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
    await expectNoHorizontalScroll(page);
    const html = await page.content();
    expect(html).not.toContain(lock.salt);
    expect(html).not.toContain(lock.hash);
    expect(html).not.toContain("/vault");
  });

  test("M9-30 a code lock in a browser: tap, the interstitial (centered, 44px controls, no sideways scroll), a wrong code, then the right one lands on the stub once and is counted once", async ({
    page,
  }, info) => {
    const { live } = await pageWithLocks("lk11");
    await page.goto(live.url);
    await page.locator(`.pg-link[data-block-id="${ID.code}"]`).click();
    await page.waitForURL(`**/r/${live.pageId}/${ID.code}`);
    await expect(page.getByRole("heading", { name: "This link is locked." })).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
    const card = page.locator("main");
    const box = (await card.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    if (info.project.name === "desktop") expect(box.width).toBeLessThanOrEqual(440);
    const input = page.getByLabel("Code");
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("link", { name: "Go back" })).toHaveAttribute("href", "/");

    // A wrong code: the interstitial again, with the sentence, and the stub saw nothing.
    await input.fill("nope-nope");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("That code didn’t match. Try again.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
    expect(stub.hits.filter((hit) => hit.url.startsWith("/vault"))).toEqual([]);

    // The right one (the form posts to the same page; the browser follows the 303 to the stub).
    const before = stub.hits.length;
    await page.getByLabel("Code").fill(CODE);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => u.host === `${stub.host}:${stub.port}`);
    expect(new URL(page.url()).pathname).toBe("/vault");
    expect(stub.hits.slice(before).map((hit) => hit.url)).toEqual(["/vault"]);
    await waitForClicks(live.pageId, 1);
    expect(await settledClicks(live.pageId)).toBe(1);
  });

  test("M9-30 an age lock in a browser: Continue lands on the stub with the page's tags, Go back returns to the page", async ({
    page,
  }) => {
    const lock = lockOf();
    const destination = stub.url("/gallery");
    const live = await livePage(
      "lk12",
      docOf([link(ID.age, destination, { lock: { kind: "age" } })], { utm: { source: "hydlnk" } }),
    );
    void lock;
    await page.goto(live.url);
    await page.locator(`.pg-link[data-block-id="${ID.age}"]`).click();
    await expect(
      page.getByRole("heading", { name: "This link may contain sensitive content." }),
    ).toBeVisible();
    await expect(page.getByText("Continue?")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
    await page.getByRole("link", { name: "Go back" }).click();
    await page.waitForURL(live.url);
    await page.locator(`.pg-link[data-block-id="${ID.age}"]`).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => u.host === `${stub.host}:${stub.port}`);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
      "/gallery?utm_source=hydlnk",
    );
    await waitForClicks(live.pageId, 1);
    expect(await settledClicks(live.pageId)).toBe(1);
  });

  test("M9-30 with JavaScript off the whole flow works: the interstitial is plain HTML with a form", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough");
    const { live } = await pageWithLocks("lk13");
    const context = await browser.newContext({ javaScriptEnabled: false, userAgent: IPHONE_UA });
    try {
      const page: Page = await context.newPage();
      await page.goto(live.url);
      await page.locator(`.pg-link[data-block-id="${ID.code}"]`).click();
      await page.waitForURL(`**/r/${live.pageId}/${ID.code}`);
      await page.getByLabel("Code").fill(CODE.toUpperCase());
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL((u) => u.host === `${stub.host}:${stub.port}`);
      expect(new URL(page.url()).pathname).toBe("/vault");
    } finally {
      await context.close();
    }
  });
});
