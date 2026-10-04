import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly, rand, signedInUser } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  APP_ORIGIN,
  CLIENT_REDIRECT,
  authorizeUrl,
  dcrHeading,
  ownAddress,
  ownIp,
  pkcePair,
  registerClient,
  registerClientViaApi,
  removeClients,
} from "../fixtures/oauth";

/**
 * M10-13 and M10-09 on the screen itself: who is asking, where the person goes afterwards, the
 * scopes in plain words, the layout at 390 and 1440, accessibility, and that everything shown is text.
 * A metadata client is made here as a CACHED row (fetched now, good for an hour), the way the
 * authorize endpoint finds one it already holds: no network, no stub.
 */

test.beforeEach(async ({ context }) => {
  await ownAddress(context);
});

test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

const made: string[] = [];

async function cachedClient(
  options: { name?: string; redirects?: string[]; logo?: Uint8Array | null; host?: string } = {},
) {
  const clientId = `https://${options.host ?? `zq-${rand(6)}.example.org`}/oauth/client.json`;
  const row = {
    client_id: clientId,
    kind: "cimd",
    client_name: options.name ?? "Zq Metadata App",
    redirect_uris: options.redirects ?? [CLIENT_REDIRECT],
    logo_png: options.logo ? `\\x${Buffer.from(options.logo).toString("hex")}` : null,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const { error } = await adminClient().from("oauth_clients").insert(row);
  if (error) throw new Error(`cachedClient failed: ${error.message}`);
  made.push(clientId);
  return { clientId, host: new URL(clientId).host };
}

async function logoPng(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 96, height: 96, channels: 3, background: "#336699" } })
      .png()
      .toBuffer(),
  );
}

async function signedIn(context: BrowserContext, label: string) {
  return signedInUser(context, { label });
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test.describe("M10-13 what the screen says", () => {
  test("M10-13 a metadata client: its name, its address in mono, where you go back to, and who is signed in", async ({
    page,
    context,
  }) => {
    const user = await signedIn(context, "ui1");
    const client = await cachedClient({ name: "Claude" });
    await page.goto(authorizeUrl(client.clientId, pkcePair().challenge));
    await expect(page).toHaveTitle("Connect an app");
    await expect(heading(page)).toHaveText("Claude wants to connect to your HYDLNK");
    await expect(page.getByRole("heading")).toHaveCount(1);
    const facts = page.locator("ul.facts li");
    await expect(facts.nth(0)).toHaveText(`Address: ${client.host}`);
    await expect(facts.nth(0).locator(".mono")).toHaveText(client.host);
    await expect(facts.nth(1)).toHaveText("When you choose, you’ll go back to a.example.");
    await expect(facts.nth(2)).toHaveText(`Connecting as ${user.email}.`);
    // The return host differs from the app's own host: a fourth line says so.
    await expect(facts.nth(3)).toHaveText(
      "This app sends you back to a different site: a.example.",
    );
    await expect(page.locator("body")).toContainText(
      "It stays connected while you use it. You can remove it any time in Settings.",
    );
    await expect(page.locator("main")).toHaveCount(1);
    // No sidebar and no tab bar: one centered card.
    await expect(page.locator("nav, aside")).toHaveCount(0);
  });

  test("M10-13 a metadata client that returns to its own site has no fourth line", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui2");
    const own = await cachedClient({ host: `own-${rand(5)}.example.org` });
    const back = `https://${own.host}/cb`;
    await adminClient()
      .from("oauth_clients")
      .update({ redirect_uris: [back] })
      .eq("client_id", own.clientId);
    await page.goto(authorizeUrl(own.clientId, pkcePair().challenge, { redirectUri: back }));
    await expect(page.locator("ul.facts li")).toHaveCount(3);
    await expect(page.locator("body")).not.toContainText("a different site");
  });

  test("M10-13 a registered client is marked as not verified, with no address", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui3");
    const client = await registerClient([CLIENT_REDIRECT], "Zq Registered");
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    // The heading leads with that the app is unverified and where you go back to (Wave L review).
    await expect(heading(page)).toHaveText(dcrHeading("Zq Registered"));
    const facts = page.locator("ul.facts li");
    await expect(facts.nth(0)).toHaveText(
      "Registered automatically. HYDLNK hasn’t verified this app.",
    );
    await expect(page.locator("body")).not.toContainText("Address:");
    await expect(page.locator("body")).not.toContainText(client.client_id);
  });

  test("M10-13 a loopback return says so, with the warning", async ({ page, context }) => {
    await signedIn(context, "ui4");
    const client = await registerClient(["http://localhost/callback"], "Zq Local");
    await page.goto(
      authorizeUrl(client.client_id, pkcePair().challenge, {
        redirectUri: "http://localhost:51234/callback",
      }),
    );
    const facts = page.locator("ul.facts li");
    await expect(facts.nth(1)).toHaveText(
      "When you choose, you’ll go back to a program on this computer (localhost). Only continue if you started this connection from an app on this computer.",
    );
    // The loopback port is accepted: Allow redirects to the exact string requested.
    await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
  });

  test("M10-13 the scopes in plain words, in the order of the spec, the first fixed", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui5");
    const client = await registerClient();
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(3);
    await expect(boxes.nth(0)).toHaveAccessibleName(/See your sites, pages and analytics/);
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(0)).toBeDisabled();
    await expect(boxes.nth(1)).toHaveAccessibleName(/Edit your drafts/);
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(1)).toBeEnabled();
    await expect(boxes.nth(2)).toHaveAccessibleName(/Publish your pages/);
    // M10-37 (Gary, 2026-10-04): Publish your pages starts unticked.
    await expect(boxes.nth(2)).not.toBeChecked();
    await expect(boxes.nth(2)).toBeEnabled();
    await expect(page.locator("body")).toContainText("Always included");
    await expect(page.locator("body")).toContainText(
      "Add, change and remove blocks, design choices and your profile in your drafts. Nothing goes live until you publish.",
    );
    await expect(page.locator("body")).toContainText(
      "Make your draft live on your public page, the same as the Publish button.",
    );
  });

  test("M10-13 the same screen for every plan", async ({ page, context }) => {
    const free = await signedIn(context, "ui6");
    await adminClient().from("accounts").update({ plan: "studio" }).eq("id", free.userId);
    const client = await registerClient();
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/upgrade|plan|pro\b/i);
  });
});

test.describe("M10-13 and M10-09 everything shown is text", () => {
  test("M10-13 a name of markup renders as those characters, no dialog and no image", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui7");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const client = await cachedClient({ name: "<img src=x onerror=alert(1)>" });
    await page.goto(authorizeUrl(client.clientId, pkcePair().challenge));
    await expect(heading(page)).toHaveText(
      "<img src=x onerror=alert(1)> wants to connect to your HYDLNK",
    );
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
    await expect(page.locator("img")).toHaveCount(0);
    expect(await page.locator("main").innerHTML()).not.toContain("<img");
  });

  test("M10-09 a registered name with a right-to-left override has it removed and does not reorder the neighboring words", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui8");
    const rlo = String.fromCodePoint(0x202e);
    const client = await registerClientViaApi([CLIENT_REDIRECT], `Pel${rlo}ican Notes`);
    expect(client.client_name).toBe("Pelican Notes");
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    const text = await heading(page).innerText();
    expect(text).toBe(dcrHeading("Pelican Notes"));
    expect(text).not.toContain(rlo);
    expect(await page.content()).not.toContain(rlo);
  });

  test("M10-13 the page makes no request to any host but the app origin", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui9");
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "data:") return;
      hosts.add(url.origin);
    });
    const client = await cachedClient({ logo: await logoPng() });
    await page.goto(authorizeUrl(client.clientId, pkcePair().challenge));
    await expect(heading(page)).toBeVisible();
    expect([...hosts]).toEqual([APP_ORIGIN]);
  });

  test("M10-09 a metadata client's re-encoded logo is embedded as a data URI; without one, initials are drawn", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui10");
    const withLogo = await cachedClient({ name: "Logo App", logo: await logoPng() });
    await page.goto(authorizeUrl(withLogo.clientId, pkcePair().challenge));
    const src = await page.locator(".avatar img").getAttribute("src");
    expect(src).toMatch(/^data:image\/png;base64,/);
    await expect(page.locator(".avatar")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".avatar img")).toHaveAttribute("alt", "");

    const plain = await cachedClient({ name: "Claude Code" });
    await page.goto(authorizeUrl(plain.clientId, pkcePair().challenge));
    await expect(page.locator(".avatar img")).toHaveCount(0);
    await expect(page.locator(".avatar")).toHaveText("CC");
    const box = await page.locator(".avatar").boundingBox();
    expect(Math.round(box!.width)).toBe(48);
    expect(Math.round(box!.height)).toBe(48);
    const radius = await page
      .locator(".avatar")
      .evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toMatch(/50%|24px/);
  });

  test("M10-09 a registered client never has a logo, whatever it declares", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui11");
    const res = await appRaw("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ownIp() },
      body: JSON.stringify({
        redirect_uris: [CLIENT_REDIRECT],
        client_name: "Sneaky",
        logo_uri: "https://evil.example.com/logo.png",
      }),
    });
    const client = JSON.parse(res.body) as { client_id: string };
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    await expect(page.locator(".avatar img")).toHaveCount(0);
    await expect(page.locator(".avatar")).toHaveText("S");
  });
});

test.describe("M10-13 headers, framing and the error page", () => {
  test("M10-13 the consent screen is never stored, never framed, sends no Referer and has no form-action", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui12");
    const client = await registerClient();
    const response = await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    const headers = response!.headers();
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).not.toContain("form-action");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-type"]).toMatch(/^text\/html/);
    expect(headers["set-cookie"]).toBeUndefined();
  });

  test("M10-14 loading the consent screen inside another origin's iframe shows nothing of it", async ({
    page,
    context,
  }) => {
    test.skip(!desktopOnly(test.info()), "one viewport is enough");
    await signedIn(context, "ui13");
    const client = await registerClient();
    const target = authorizeUrl(client.client_id, pkcePair().challenge);
    await page.route("https://framer.example/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<iframe id="f" src="${target}" width="600" height="600"></iframe>`,
      }),
    );
    await page.goto("https://framer.example/");
    await page.waitForTimeout(1000);
    for (const frame of page.frames()) {
      expect(await frame.content().catch(() => ""), frame.url()).not.toContain("wants to connect");
    }
    expect(
      page
        .frames()
        .some(
          (frame) =>
            frame.url().startsWith(`${APP_ORIGIN}/oauth/authorize`) && frame.parentFrame() !== null,
        ),
    ).toBe(false);
  });

  test("M10-11 the error page echoes nothing of the request, carries no cookie and is a 400", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "<script>alert(1)</script>",
      redirect_uri: "javascript:alert(1)",
      state: "<b>x</b>",
    });
    const res = await appRaw(`/oauth/authorize?${query}`, {
      headers: { "x-forwarded-for": ownIp() },
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain("This sign-in request isn’t valid.");
    expect(res.body).toContain("We don’t recognize this app.");
    expect(res.body).toContain("Go back to the app and try again.");
    for (const needle of ["<script>alert", "javascript:alert", "alert(1)", "&lt;script", "<b>x"]) {
      expect(res.body, needle).not.toContain(needle);
      expect(JSON.stringify(res.headers), needle).not.toContain(needle);
    }
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.setCookies).toEqual([]);
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });
});

test.describe("M10-13 layout and accessibility", () => {
  test("M10-13 at 390: the card fills the width, nothing scrolls sideways, every target is 44px, Allow and Deny are stacked", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedIn(context, "ui14");
    const client = await cachedClient({
      name: "Zq Long Name ".repeat(6).trim(),
      host: `a-very-long-host-name-${rand(8)}.example-company-name.org`,
    });
    await page.goto(authorizeUrl(client.clientId, pkcePair().challenge));
    await expect(heading(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    const card = (await page.locator("main").boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(15);
    expect(card.x + card.width).toBeLessThanOrEqual(375.5);
    expect(card.width).toBeGreaterThan(330);

    const allow = (await page.getByRole("button", { name: "Allow" }).boundingBox())!;
    const deny = (await page.getByRole("button", { name: "Deny" }).boundingBox())!;
    expect(deny.y).toBeGreaterThan(allow.y + allow.height - 1);
    expect(Math.abs(allow.width - deny.width)).toBeLessThan(1);
    expect(allow.width).toBeGreaterThan(card.width - 40);
    expect(allow.height).toBeGreaterThanOrEqual(44);
    expect(deny.height).toBeGreaterThanOrEqual(44);

    // Deny does not look like Allow: a different fill.
    const fills = await page.evaluate(() => {
      const get = (value: string) =>
        getComputedStyle(document.querySelector(`button[value="${value}"]`)!).backgroundColor;
      return { allow: get("allow"), deny: get("deny") };
    });
    expect(fills.allow).not.toBe(fills.deny);

    // The focus order is the scopes, then Allow, then Deny.
    const order: string[] = [];
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLInputElement | HTMLButtonElement | null;
          return el
            ? `${el.tagName.toLowerCase()}:${el.getAttribute("value") ?? el.textContent?.trim()}`
            : "";
        }),
      );
    }
    const interesting = order.filter((entry) => /allow|deny|hydlnk\./.test(entry));
    expect(interesting).toEqual([
      "input:hydlnk.write",
      "input:hydlnk.publish",
      "button:allow",
      "button:deny",
    ]);
  });

  test("M10-13 at 1440: a centered card no wider than 480px on the page background, Deny and Allow side by side", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedIn(context, "ui15");
    const client = await registerClient();
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    const card = (await page.locator("main").boundingBox())!;
    expect(card.width).toBeLessThanOrEqual(480.5);
    expect(Math.abs(card.x + card.width / 2 - 720)).toBeLessThan(2);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe("rgb(244, 243, 240)");

    const allow = (await page.getByRole("button", { name: "Allow" }).boundingBox())!;
    const deny = (await page.getByRole("button", { name: "Deny" }).boundingBox())!;
    expect(Math.abs(allow.y - deny.y)).toBeLessThan(2);
    expect(deny.x + deny.width).toBeLessThanOrEqual(allow.x);
    expect(allow.height).toBeGreaterThanOrEqual(44);
    expect(deny.height).toBeGreaterThanOrEqual(44);
    expect(allow.x + allow.width).toBeGreaterThan(card.x + card.width - 40);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("M10-13 axe finds no serious or critical violation, with and without a logo", async ({
    page,
    context,
  }) => {
    await signedIn(context, "ui16");
    const plain = await cachedClient({ name: "Plain App" });
    await page.goto(authorizeUrl(plain.clientId, pkcePair().challenge));
    expect(await axeViolations(page)).toEqual([]);
    const logo = await cachedClient({ name: "Logo App", logo: await logoPng() });
    await page.goto(authorizeUrl(logo.clientId, pkcePair().challenge));
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M10-13 axe on the other states: suspended, connected before, a message page, the error page", async ({
    page,
    context,
  }) => {
    const user = await signedIn(context, "ui17");
    const client = await registerClient();
    await page.goto(`${APP_ORIGIN}/oauth/authorize?client_id=nope`);
    expect(await axeViolations(page)).toEqual([]);
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", user.userId);
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge));
    await expect(page.locator("body")).toContainText("suspended");
    expect(await axeViolations(page)).toEqual([]);
  });
});

void randomBytes;
