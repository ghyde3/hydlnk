import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { desktopOnly, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { DEV_PORT, expectNoHorizontalScroll, url } from "../helpers";
import { addDomainRow } from "../m4/domains-core-helpers";
import { randomIp } from "../m4/analytics-ingest-helpers";
import { draftOf, publishDocOf, userWithDraft } from "../m2/blocks-helpers";
import { makeLink, sharePath } from "../m6/pages-helpers";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { usesProductionServer } from "../../../scripts/lib/e2e-server";
import {
  CONTACT_ID,
  SIGNUP_ID,
  expectFormControls,
  formPage,
  signupForm,
  storedRows,
  waitForRows,
} from "./forms-helpers";

/**
 * M17-04, M17-05, M17-06 at 390x844 and 1440x900: the form on the live page (plain HTML, one
 * renderer, the open marker), the /f routes on a page's own hosts only, and a submission end to end
 * with JavaScript on and off, through the confirm step when the open marker is missing.
 */

const form = (page: Page, id: string) => page.locator(`form[data-block-id="${id}"]`);

test.beforeEach(async ({ context }) => {
  // One client per test: the form limits count per client, and every local request has none.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

test.describe("M17-04 the form on the live page", () => {
  test("the share link draws the form and loads no marker", async ({ page, context }) => {
    const owner = await userWithDraft(context, "fsh", (handle) => draftOf(handle, [signupForm()]));
    const link = await makeLink(owner.userId, owner.pageId);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    const response = await page.goto(url("app", sharePath(link.token)));
    expect(response!.status()).toBe(200);
    await expect(form(page, SIGNUP_ID)).toBeVisible();
    expect(requests.filter((path) => path.startsWith("/f/"))).toEqual([]);
    expect(await page.content()).not.toContain(`/f/${owner.pageId}/o`);
    await expectNoHorizontalScroll(page);
  });

  test("labelled fields, the button and the consent line; the marker loads once; 44px controls, 16px text, no sideways scroll", async ({
    page,
  }) => {
    const live = await formPage("fp1");
    const markers: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/f/")) markers.push(request.url());
    });
    await page.goto(live.url);
    const signup = form(page, SIGNUP_ID);
    await expect(signup).toHaveAttribute("action", `/f/${live.pageId}/${SIGNUP_ID}`);
    await expect(signup).toHaveAttribute("method", "post");
    await expect(signup.getByLabel("Email")).toHaveAttribute("type", "email");
    await expect(signup.getByLabel("Name")).toHaveCount(0);
    const contact = form(page, CONTACT_ID);
    for (const label of ["Name", "Email", "Message"])
      await expect(contact.getByLabel(label)).toBeVisible();
    await expect(contact.locator("button + p.pg-form-consent")).toHaveText(
      "Your details go to the owner of this page, who may contact you.",
    );
    // The honeypot is not visible and not reachable by Tab.
    const trap = signup.locator('input[name="hl_confirm"]');
    await expect(trap).not.toBeInViewport();
    await expect(trap).toHaveAttribute("tabindex", "-1");
    await expectFormControls(page);
    await expectNoHorizontalScroll(page);
    await expect
      .poll(() => markers)
      .toEqual([`http://${new URL(live.url).host}/f/${live.pageId}/o`]);
  });

  test("a page without a form block requests no marker and draws no form", async ({ page }) => {
    const live = await formPage("fp2", {
      blocks: [
        {
          id: "lnkFormE2E2",
          type: "link",
          visible: true,
          label: "Shop",
          url: "https://example.com/",
        },
      ],
    });
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto(live.url);
    await expect(page.getByRole("link", { name: "Shop" })).toBeVisible();
    expect(requests.some((path) => path.startsWith("/f/"))).toBe(false);
    await expect(page.locator("form")).toHaveCount(0);
  });

  test("author text is escaped", async ({ page }) => {
    const live = await formPage("fp3", {
      blocks: [
        {
          ...(await import("./forms-helpers")).signupForm({
            heading: "<img src=x onerror=alert(1)>",
          }),
        },
      ],
    });
    await page.goto(live.url);
    await expect(page.locator(".pg-form-heading")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(page.locator(".pg-form img")).toHaveCount(0);
  });
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(`M17-06 sending, JavaScript ${javaScriptEnabled ? "on" : "off"}`, () => {
    test.use({ javaScriptEnabled });

    test("a sign-up after 3 seconds lands on the sent page and is stored once", async ({
      page,
    }) => {
      const live = await formPage(`fs${javaScriptEnabled ? "j" : "n"}`);
      await page.goto(live.url);
      await page.waitForTimeout(3200);
      await form(page, SIGNUP_ID).getByLabel("Email").fill("visitor@example.test");
      await form(page, SIGNUP_ID).getByRole("button", { name: "Subscribe" }).click();
      await expect(page).toHaveURL(`${live.url.replace(/\/$/, "")}/f/${live.pageId}/${SIGNUP_ID}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sent");
      await expect(page.getByRole("status")).toHaveText("Thanks. You’re on the list.");
      await expect(page.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
      await expectFormControls(page);
      await expectNoHorizontalScroll(page);
      const rows = await waitForRows(live.pageId, 1);
      expect(rows[0]).toMatchObject({
        block_id: SIGNUP_ID,
        kind: "signup",
        email: "visitor@example.test",
        entry_id: null,
      });
      // One click row under the form block's id, recorded after the answer.
      await expect
        .poll(async () => {
          const { data } = await adminClient()
            .from("events")
            .select("block_id, type")
            .eq("page_id", live.pageId)
            .eq("type", "click");
          return data;
        })
        .toEqual([{ block_id: SIGNUP_ID, type: "click" }]);
    });

    test("a contact message after 3 seconds is stored with the name and message", async ({
      page,
    }) => {
      const live = await formPage(`fc${javaScriptEnabled ? "j" : "n"}`);
      await page.goto(live.url);
      await page.waitForTimeout(3200);
      const contact = form(page, CONTACT_ID);
      await contact.getByLabel("Name").fill("Vera Visitor");
      await contact.getByLabel("Email").fill("vera@example.test");
      await contact.getByLabel("Message").fill("Hello,\nI would like a print.");
      await contact.getByRole("button", { name: "Send" }).click();
      await expect(page.getByRole("status")).toHaveText("Thanks. Your message was sent.");
      const rows = await waitForRows(live.pageId, 1);
      expect(rows[0]).toMatchObject({
        kind: "contact",
        name: "Vera Visitor",
        email: "vera@example.test",
        message: "Hello,\nI would like a print.",
      });
    });

    test("sent at once with images blocked: the confirm page, then Send stores it", async ({
      page,
    }) => {
      const live = await formPage(`fk${javaScriptEnabled ? "j" : "n"}`);
      await page.route("**/f/*/o", (route) => route.abort());
      await page.goto(live.url);
      await form(page, SIGNUP_ID).getByLabel("Email").fill("later@example.test");
      await form(page, SIGNUP_ID).getByRole("button", { name: "Subscribe" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check and send");
      await expect(page.getByLabel("Email")).toHaveValue("later@example.test");
      await expectFormControls(page);
      await expectNoHorizontalScroll(page);
      expect(await storedRows(live.pageId)).toEqual([]);
      await page.waitForTimeout(2200);
      await page.getByRole("button", { name: "Subscribe" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sent");
      await waitForRows(live.pageId, 1);
    });
  });
}

test.describe("M17-06 a field error, JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("an empty email (the browser's check passed by, as a non-browser client would) shows the error and keeps the other values", async ({
    page,
  }) => {
    const live = await formPage("fe2");
    await page.goto(live.url);
    await page.waitForTimeout(3200);
    // No script runs on this page: the request itself is rewritten on its way out, email emptied.
    await page.route(`**/f/${live.pageId}/${CONTACT_ID}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = new URLSearchParams(route.request().postData() ?? "");
      body.set("email", "");
      await route.continue({ postData: body.toString() });
    });
    const contact = form(page, CONTACT_ID);
    await contact.getByLabel("Name").fill("Vera Visitor");
    await contact.getByLabel("Email").fill("placeholder@example.test");
    await contact.getByLabel("Message").fill("Kept as typed");
    await contact.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fix and send");
    await expect(page.getByText("Enter an email address.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Name")).toHaveValue("Vera Visitor");
    await expect(page.getByLabel("Message")).toHaveValue("Kept as typed");
    await expectFormControls(page);
    await expectNoHorizontalScroll(page);
    expect(await storedRows(live.pageId)).toEqual([]);
  });
});

test.describe("M17-06 a field error", () => {
  test("an empty email shows the error on its field and keeps the other values", async ({
    page,
  }) => {
    const live = await formPage("fe1");
    await page.goto(live.url);
    await page.waitForTimeout(3200);
    const contact = form(page, CONTACT_ID);
    // The browser's own check would stop an empty required field; the server's is what is tested.
    await contact.evaluate((el) => ((el as HTMLFormElement).noValidate = true));
    await contact.getByLabel("Name").fill("Vera Visitor");
    await contact.getByLabel("Message").fill("Kept as typed");
    await contact.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fix and send");
    await expect(page.getByText("Enter an email address.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Name")).toHaveValue("Vera Visitor");
    await expect(page.getByLabel("Message")).toHaveValue("Kept as typed");
    await expectFormControls(page);
    await expectNoHorizontalScroll(page);
    expect(await storedRows(live.pageId)).toEqual([]);
  });
});

test.describe("M17-05 the routes and their hosts", () => {
  test("answer on the handle host and a verified custom host; 404 on the root and app hosts", async ({
    page,
  }) => {
    // Both sizes (M17-05 step 6): the raw answers, then the sent page in the browser at this size.
    const live = await formPage("fr1", { plan: "pro" });
    const handleHost = `${live.handle}.localhost:3000`;
    const hostname = `links-${rand(6)}.example.test`;
    await addDomainRow({ pageId: live.pageId, hostname, status: "verified" });
    const customHost = `${hostname}:${DEV_PORT}`;
    for (const host of [handleHost, customHost]) {
      const sent = await rawRequest(host, `/f/${live.pageId}/${SIGNUP_ID}`);
      expect(sent.status, host).toBe(200);
      expect(sent.body).toContain("Thanks. You’re on the list.");
      expect(String(sent.headers["content-security-policy"])).toContain("form-action 'self'");
      expect(sent.headers["cache-control"]).toBe("no-store");
      expect(sent.headers["x-robots-tag"]).toBe("noindex");
      expect(sent.headers["x-frame-options"]).toBe("DENY");
      expect(sent.setCookies).toEqual([]);
      expect(sent.body).not.toContain("<script");
      const marker = await rawRequest(host, `/f/${live.pageId}/o`);
      expect(marker.status, host).toBe(200);
      expect(marker.headers["content-type"]).toBe("image/gif");
    }
    for (const host of ["localhost:3000", "app.localhost:3000"]) {
      expect((await rawRequest(host, `/f/${live.pageId}/${SIGNUP_ID}`)).status, host).toBe(404);
    }
    // A POST to / is still 405; to a path that is no route, the plain 404.
    expect((await rawRequest(handleHost, "/", { method: "POST" })).status).toBe(405);
    expect((await rawRequest(handleHost, "/about-x", { method: "POST" })).status).toBe(404);
    // In the browser at this size: the sent page, its Back link 44px tall, no sideways scroll.
    const sentPage = await page.goto(
      `${live.url.replace(/\/$/, "")}/f/${live.pageId}/${SIGNUP_ID}`,
    );
    expect(sentPage!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sent");
    await expectFormControls(page);
    await expectNoHorizontalScroll(page);
    const notFound = await page.goto(url(null, `/f/${live.pageId}/${SIGNUP_ID}`));
    expect(notFound!.status()).toBe(404);
  });

  test("fifty invented /f/<uuid>/<id> paths are the 404 notice, dynamic, never cached, and make no data-cache entry", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    test.setTimeout(120_000);
    const live = await formPage("fr5");
    const host = `${live.handle}.localhost:3000`;
    const uuid = () => crypto.randomUUID();
    const invented: string[] = [];
    for (let i = 0; i < 50; i++) {
      const pageId = uuid();
      invented.push(pageId);
      const path = i % 3 === 0 ? `/f/${pageId}/o` : `/f/${pageId}/form${rand(8)}`;
      const res =
        i % 3 === 2
          ? await rawRequest(host, path, {
              method: "POST",
              body: "email=x%40example.test&hl_confirm=&t=",
              headers: {
                "content-type": "application/x-www-form-urlencoded",
                origin: `http://${host.replace(/:3000$/, `:${DEV_PORT}`)}`,
                "x-forwarded-for": randomIp(),
              },
            })
          : await rawRequest(host, path, { headers: { "x-forwarded-for": randomIp() } });
      expect(res.status, path).toBe(404);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-nextjs-cache"]).toBeUndefined();
      expect(res.headers["x-robots-tag"]).toBe("noindex");
      expect(String(res.headers["content-security-policy"])).toContain("form-action 'self'");
    }
    // On a production build (next start) the data cache is on disk: no entry names an invented
    // page id (each entry carries its page tag, so this holds while other workers fill the cache).
    if (usesProductionServer(process.env)) {
      const dir = join(process.cwd(), ".next", "cache", "fetch-cache");
      const entries = () => readdirSync(dir).map((name) => readFileSync(join(dir, name), "utf8"));
      const named = (pageId: string) => entries().filter((text) => text.includes(pageId)).length;
      const all = entries();
      expect(all.length).toBeGreaterThan(0);
      const anyInvented = new RegExp(invented.join("|"));
      expect(all.filter((text) => anyInvented.test(text))).toEqual([]);
      // A real site through /f is cached (the cache is in play, so the negative above is real).
      await rawRequest(host, `/f/${live.pageId}/${SIGNUP_ID}`);
      expect(named(live.pageId)).toBeGreaterThan(0);
    }
    expect(await storedRows(live.pageId)).toEqual([]);
  });

  test("a path under /f/ that is no form route is the plain tenant 404 (forms attack pass, finding 5)", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const live = await formPage("fr6");
    const host = `${live.handle}.localhost:3000`;
    for (const path of [
      `/f/${live.pageId}`,
      `/f/${live.pageId}/${SIGNUP_ID}/extra`,
      `/f/${live.pageId}/o/extra`,
      `/f/${live.pageId}/%E0%A4%A`,
      `/f/%ZZ/${SIGNUP_ID}`,
    ]) {
      for (const method of ["GET", "POST"]) {
        const res = await rawRequest(host, path, {
          method,
          headers: { "x-forwarded-for": randomIp() },
        });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(String(res.headers["content-security-policy"]), path).toContain(
          "form-action 'self'",
        );
        expect(res.headers["x-frame-options"], path).toBe("DENY");
        expect(res.body, path).not.toContain("<script");
      }
    }
  });

  test("a cross-site POST is 403 and a POST with the wrong type 415; nothing is stored", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const live = await formPage("fr2");
    const host = `${live.handle}.localhost:3000`;
    const body = "email=x%40example.test&hl_confirm=&t=";
    const cross = await rawRequest(host, `/f/${live.pageId}/${SIGNUP_ID}`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://evil.example",
        "x-forwarded-for": randomIp(),
      },
    });
    expect(cross.status).toBe(403);
    const json = await rawRequest(host, `/f/${live.pageId}/${SIGNUP_ID}`, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", "x-forwarded-for": randomIp() },
    });
    expect(json.status).toBe(415);
    expect(await storedRows(live.pageId)).toEqual([]);
  });

  test("/f alone is still a sub-page path", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const live = await formPage("fr3");
    const type = await adminClient()
      .from("content_types")
      .select("id")
      .eq("site_id", live.pageId)
      .eq("key", "page")
      .single();
    const doc = { path: "f", title: "F page", description: "", blocks: [] };
    const made = await adminClient()
      .from("content_entries")
      .insert({
        site_id: live.pageId,
        type_id: type.data!.id,
        draft: doc,
        published: doc,
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    const response = await rawRequest(`${live.handle}.localhost:3000`, "/f");
    expect(response.status).toBe(200);
    expect(response.body).toContain("F page");
  });

  test("a hidden or draft-only form takes nothing: the 404 notice", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const { signupForm } = await import("./forms-helpers");
    const live = await formPage("fr4", {
      blocks: [publishDocOf([]).blocks, signupForm({ visible: false })].flat() as never,
    });
    const host = `${live.handle}.localhost:3000`;
    const sent = await rawRequest(host, `/f/${live.pageId}/${SIGNUP_ID}`);
    expect(sent.status).toBe(404);
    const other = await rawRequest(host, `/f/${live.pageId}/notARealId1`);
    expect(other.status).toBe(404);
  });
});
