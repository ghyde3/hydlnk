import { expect, test } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import {
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  rand,
  signedInUser,
} from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { publishDocOf, publishedPage } from "../m2/blocks-helpers";
import { accessToken, expectDraft, openEditor, pageRow, seededUser } from "../m2/editor-helpers";
import { pngSizeOf, rawBuffer, tenantGet } from "../m2/publish-helpers";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import type { Block, PublishDoc } from "@/lib/document";
import {
  BLUE,
  RED,
  liveTags,
  metaContents,
  near,
  pixelAt,
  publishNow,
  removeObjects,
  shareCard,
  shareTitle,
  socialTags,
  splitImage,
  storeImage,
  waitDraft,
} from "./share-helpers";

/**
 * M6-32: the share fields in the published page's metadata and its social image. Almost all of it
 * is plain HTTP against the tenant host (pages written with the secret key), so it runs on the
 * desktop project; the layout checks run on both. The schema, the Publish gate and the cache key
 * are in tests/unit/m6-share-*.test.ts.
 */

// Publish runs a Server Action on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 120_000 });

const stored: string[] = [];
test.afterAll(async () => {
  await removeObjects(stored.splice(0));
  await cleanupUsers();
});

const BLOCKS: Block[] = [
  {
    id: "lnk-share-0001",
    type: "link",
    visible: true,
    label: "Listen",
    url: "https://example.com/a",
  },
  {
    id: "lnk-share-0002",
    type: "link",
    visible: true,
    label: "Tickets",
    url: "https://example.com/b",
  },
];

type SharePatch = NonNullable<PublishDoc["share"]>;

const docWith = (share?: SharePatch, opts: { name?: string; bio?: string } = {}): PublishDoc => {
  const doc = publishDocOf(BLOCKS, {
    name: opts.name ?? "Mara Okafor",
    bio: opts.bio ?? "Photographer in Orlando",
  });
  return share ? { ...doc, share } : doc;
};

const msOf = async (pageId: string): Promise<number> => {
  const { data, error } = await adminClient()
    .from("pages")
    .select("published_at")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return Date.parse(data.published_at as string);
};

/** Rewrites what is live (the secret key does what Publish does), with a fresh published_at. */
async function republish(pageId: string, doc: PublishDoc): Promise<void> {
  const { error } = await adminClient()
    .from("pages")
    .update({ published: doc, published_at: new Date(Date.now() + 5).toISOString() })
    .eq("id", pageId);
  if (error) throw new Error(error.message);
}

const ogOf = async (handle: string) => {
  const res = await tenantGet(handle, "/og");
  return res;
};

test.describe("M6-32 the tags on the handle host", () => {
  test("M6-32 og and twitter title and description are the share fields; <title>, description, image, type and card are as before", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage(
      "mt1",
      docWith({ title: "Hear the new album", description: "Out Friday. Tap to listen." }),
    );
    const { status, tags, text } = await liveTags(live.handle);
    expect(status).toBe(200);
    const ms = await msOf(live.pageId);
    expect(tags.ogTitle).toBe("Hear the new album");
    expect(tags.twitterTitle).toBe("Hear the new album");
    expect(tags.ogDescription).toBe("Out Friday. Tap to listen.");
    expect(tags.twitterDescription).toBe("Out Friday. Tap to listen.");
    // Unchanged: the document title and the meta description keep the name and the bio (M2-22).
    expect(tags.title).toBe("Mara Okafor - links");
    expect(tags.description).toBe("Photographer in Orlando");
    // Unchanged: the page's own image on the same host, versioned by the publish time (M2-30).
    expect(tags.ogImage).toBe(`${url(live.handle).replace(/\/$/, "")}/og?v=${ms}`);
    expect(tags.twitterImage).toBe(tags.ogImage);
    expect(tags.ogType).toBe("website");
    expect(tags.twitterCard).toBe("summary_large_image");
    expect(tags.ogUrl).toBe(url(live.handle));
    // Exactly once: one og:title tag, one og:description tag.
    expect(metaContents(text, "og:title")).toEqual(["Hear the new album"]);
    expect(metaContents(text, "og:description")).toEqual(["Out Friday. Tap to listen."]);
  });

  test("M6-32 with no share fields the tags are the name and the bio, exactly as before", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage("mt2", docWith());
    const { tags } = await liveTags(live.handle);
    expect(tags.ogTitle).toBe("Mara Okafor");
    expect(tags.twitterTitle).toBe("Mara Okafor");
    expect(tags.ogDescription).toBe("Photographer in Orlando");
    expect(tags.twitterDescription).toBe("Photographer in Orlando");
    expect(tags.title).toBe("Mara Okafor - links");
    expect(tags.description).toBe("Photographer in Orlando");
  });

  test("M6-32 only a title, or only a description, falls back per field", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const onlyTitle = await publishedPage("mt3", docWith({ title: "Just a title" }));
    const a = (await liveTags(onlyTitle.handle)).tags;
    expect([a.ogTitle, a.ogDescription]).toEqual(["Just a title", "Photographer in Orlando"]);
    const onlyDescription = await publishedPage("mt4", docWith({ description: "Just words" }));
    const b = (await liveTags(onlyDescription.handle)).tags;
    expect([b.ogTitle, b.ogDescription]).toEqual(["Mara Okafor", "Just words"]);
  });

  test('M6-32 a title of "><script>alert(1)</script> is HTML-escaped inside the content attribute and injects no element', async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const evil = '"><script>alert(1)</script>';
    const live = await publishedPage(
      "mt5",
      docWith({ title: evil, description: "<img src=x onerror=alert(2)>" }),
    );
    const { text, tags } = await liveTags(live.handle);
    // The attribute holds the text, decoded back to what was typed.
    expect(tags.ogTitle).toBe(evil);
    expect(tags.twitterTitle).toBe(evil);
    expect(tags.ogDescription).toBe("<img src=x onerror=alert(2)>");
    // Escaped on the wire, and no element made out of it.
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).not.toContain("<img src=x onerror=alert(2)>");
    expect(text).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    // Parsed like a browser would: no script element carries the payload, nothing has an onerror, and
    // the two tags hold the text as an attribute value.
    await page.goto("about:blank");
    const parsed = await page.evaluate((markup) => {
      const dom = new DOMParser().parseFromString(markup, "text/html");
      return {
        payloadScripts: Array.from(dom.querySelectorAll("script")).filter(
          (el) => /alert\(1\)/.test(el.textContent ?? "") && !/__next_f/.test(el.textContent ?? ""),
        ).length,
        handlers: dom.querySelectorAll("[onerror], [onload]").length,
        ogTitle: dom.querySelector('meta[property="og:title"]')?.getAttribute("content"),
        twitterTitle: dom.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
      };
    }, text);
    expect(parsed).toEqual({ payloadScripts: 0, handlers: 0, ogTitle: evil, twitterTitle: evil });
  });

  test("M6-32 a suspended owner's page answers 404 with none of the share text, for the page and for /og", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const owner = await makeUser("mt6", { suspended: true });
    const handle = `zq-mt6-${rand(5)}`;
    await insertPage(owner.id, handle, {
      published: docWith({ title: "SECRET-SHARE-TITLE", description: "SECRET-SHARE-DESCRIPTION" }),
      published_at: new Date().toISOString(),
    });
    const page = await tenantGet(handle);
    expect(page.status).toBe(404);
    expect(page.text).not.toContain("SECRET-SHARE");
    expect(page.text).not.toContain("Mara Okafor");
    const og = await ogOf(handle);
    expect(og.status).toBe(404);
    expect(og.headers["content-type"] ?? "").not.toContain("image/png");
  });
});

test.describe("M6-32 the social image", () => {
  test("M6-32 /og draws the uploaded picture to cover the frame around its focus: x=0 is red at the center, x=1 is blue", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage("mi1", docWith());
    const ref = await storeImage(live.userId, await splitImage(2400, 630), {
      width: 2400,
      height: 630,
    });
    stored.push(ref.path);

    for (const [x, expected, label] of [
      [0, RED, "red"],
      [1, BLUE, "blue"],
    ] as const) {
      await republish(
        live.pageId,
        docWith({ title: "T", image: { ...ref, focus: { x, y: 0.5 } } }),
      );
      const res = await ogOf(live.handle);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(pngSizeOf(res.body)).toEqual({ width: 1200, height: 630 });
      expect(near(await pixelAt(res.body, 600, 315), expected), `x=${x} center is ${label}`).toBe(
        true,
      );
    }
    // No focus is the center: the red and blue halves meet in the middle of the frame.
    await republish(live.pageId, docWith({ image: ref }));
    const centered = await ogOf(live.handle);
    expect(near(await pixelAt(centered.body, 300, 315), RED)).toBe(true);
    expect(near(await pixelAt(centered.body, 900, 315), BLUE)).toBe(true);
  });

  test("M6-32 the picture is the whole image: no text is drawn on it", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage("mi2", docWith());
    const ref = await storeImage(live.userId, await splitImage(1200, 630), {
      width: 1200,
      height: 630,
    });
    stored.push(ref.path);
    await republish(live.pageId, docWith({ title: "Words that must not appear", image: ref }));
    const png = (await ogOf(live.handle)).body;
    // An exact 1200x630 picture comes back as itself: every sampled pixel is pure red or blue.
    for (const [x, y] of [
      [10, 10],
      [590, 40],
      [610, 300],
      [1190, 620],
      [300, 315],
      [900, 315],
    ] as const) {
      const pixel = await pixelAt(png, x, y);
      expect(near(pixel, x < 600 ? RED : BLUE), `pixel ${x},${y}`).toBe(true);
    }
  });

  test("M6-32 an object that was deleted, or is not an image, falls back to the generated card with HTTP 200", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage("mi3", docWith());
    const plain = await ogOf(live.handle);
    expect(plain.status).toBe(200);

    // Deleted: the path matches the pattern, the object does not exist.
    const gone = { path: `${live.userId}/img-${"cafe0123babe"}.webp`, width: 1600, height: 800 };
    await republish(live.pageId, docWith({ image: gone }));
    const deleted = await ogOf(live.handle);
    expect(deleted.status).toBe(200);
    expect(deleted.headers["content-type"]).toBe("image/png");
    expect(pngSizeOf(deleted.body)).toEqual({ width: 1200, height: 630 });
    expect(deleted.body.equals(plain.body)).toBe(true);

    // Not an image: bytes that are not a picture, stored where a picture goes.
    const junk = await storeImage(live.userId, Buffer.from("not an image at all"), {
      width: 1600,
      height: 800,
    });
    stored.push(junk.path);
    await republish(live.pageId, docWith({ image: junk }));
    const wrong = await ogOf(live.handle);
    expect(wrong.status).toBe(200);
    expect(pngSizeOf(wrong.body)).toEqual({ width: 1200, height: 630 });
    expect(wrong.body.equals(plain.body)).toBe(true);
  });

  test("M6-32 a page without share fields gets the same image bytes as one whose share fields are only text", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage("mi4", docWith());
    const before = await ogOf(live.handle);
    await republish(live.pageId, docWith({ title: "Only words", description: "No picture" }));
    const after = await ogOf(live.handle);
    // Title and description are tags, never drawn: the generated card is the same card.
    expect(after.body.equals(before.body)).toBe(true);
  });
});

test.describe("M6-32 a verified custom host", () => {
  test("M6-32 on /sites/[pageId] the same rules apply, and og:url and og:image name the custom host", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage(
      "mc1",
      docWith({ title: "Custom host title", description: "Custom host words" }),
      {
        plan: "pro",
      },
    );
    const host = hostnameFor("mc1");
    await addDomainRow({ pageId: live.pageId, hostname: host, status: "verified" });

    const res = await rawBuffer(host, "/");
    expect(res.status).toBe(200);
    const tags = socialTags(res.text);
    const ms = await msOf(live.pageId);
    expect(tags.ogTitle).toBe("Custom host title");
    expect(tags.twitterTitle).toBe("Custom host title");
    expect(tags.ogDescription).toBe("Custom host words");
    expect(tags.title).toBe("Mara Okafor - links");
    expect(tags.description).toBe("Photographer in Orlando");
    expect(tags.ogUrl).toBe(`http://${host}:3000/`);
    expect(tags.ogImage).toBe(`http://${host}:3000/og?v=${ms}`);
    expect(tags.twitterImage).toBe(tags.ogImage);
    expect(metaContents(res.text, "og:title")).toEqual(["Custom host title"]);

    // Its image is the same picture the handle host serves.
    const image = await rawBuffer(host, `/og?v=${ms}`);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(pngSizeOf(image.body)).toEqual({ width: 1200, height: 630 });
    expect(image.body.equals((await ogOf(live.handle)).body)).toBe(true);
  });

  test("M6-32 a share image shows on the custom host's /og at once, with the same pixels", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const live = await publishedPage("mc2", docWith(), { plan: "pro" });
    const host = hostnameFor("mc2");
    await addDomainRow({ pageId: live.pageId, hostname: host, status: "verified" });
    const ref = await storeImage(live.userId, await splitImage(2400, 630), {
      width: 2400,
      height: 630,
    });
    stored.push(ref.path);
    await republish(live.pageId, docWith({ image: { ...ref, focus: { x: 1, y: 0.5 } } }));
    const image = await rawBuffer(host, "/og");
    expect(near(await pixelAt(image.body, 600, 315), BLUE)).toBe(true);
    expect(image.body.equals((await ogOf(live.handle)).body)).toBe(true);
  });
});

test.describe("M6-32 timing: the live page changes at Publish and not before", () => {
  test("M6-32 an autosave of the share fields changes no tag and no image byte; Publish changes both at once", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough: it drives one editor");
    const user = await seededUser(context, "mp1");
    await openEditor(page);
    const tagsBefore = (await liveTags(user.handle)).tags;
    const imageBefore = (await ogOf(user.handle)).body;

    await shareTitle(page).fill("Draft only title");
    await shareCard(page)
      .locator('input[type="file"]')
      .setInputFiles({
        name: "wide.png",
        mimeType: "image/png",
        buffer: await splitImage(1600, 800, "png"),
      });
    const draft = await expectDraft(
      user.pageId,
      (d) => Boolean(d.share?.image?.path) && d.share?.title === "Draft only title",
    );
    stored.push(draft.share!.image!.path);
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

    const tagsDuring = (await liveTags(user.handle)).tags;
    const imageDuring = (await ogOf(user.handle)).body;
    expect(tagsDuring).toEqual(tagsBefore);
    expect(imageDuring.equals(imageBefore)).toBe(true);

    await publishNow(page);
    const tagsAfter = (await liveTags(user.handle)).tags;
    const imageAfter = (await ogOf(user.handle)).body;
    expect(tagsAfter.ogTitle).toBe("Draft only title");
    expect(tagsAfter.ogImage).not.toBe(tagsBefore.ogImage);
    expect(imageAfter.equals(imageBefore)).toBe(false);
    expect(pngSizeOf(imageAfter)).toEqual({ width: 1200, height: 630 });
  });
});

test.describe("M6-32 timing on a custom host", () => {
  test("M6-32 Publish changes the tags and the image on the verified custom host at once, and og:url and og:image name that host", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough: it drives one editor");
    const user = await signedInUser(context, { label: "mp2", plan: "pro" });
    const host = hostnameFor("mp2");
    await addDomainRow({ pageId: user.pageId, hostname: host, status: "verified" });
    await openEditor(page);
    const before = socialTags((await rawBuffer(host, "/")).text);
    const imageBefore = (await rawBuffer(host, "/og")).body;

    await shareTitle(page).fill("Custom host, after Publish");
    await shareCard(page)
      .locator('input[type="file"]')
      .setInputFiles({
        name: "wide.png",
        mimeType: "image/png",
        buffer: await splitImage(1600, 800, "png"),
      });
    const draft = await waitDraft(
      user.pageId,
      (d) => Boolean(d.share?.image?.path) && d.share?.title === "Custom host, after Publish",
    );
    stored.push(draft.share!.image!.path);

    // Autosave alone changes nothing on the custom host.
    expect(socialTags((await rawBuffer(host, "/")).text)).toEqual(before);
    expect((await rawBuffer(host, "/og")).body.equals(imageBefore)).toBe(true);

    await publishNow(page);
    const res = await rawBuffer(host, "/");
    const after = socialTags(res.text);
    const ms = await msOf(user.pageId);
    expect(after.ogTitle).toBe("Custom host, after Publish");
    expect(after.twitterTitle).toBe("Custom host, after Publish");
    expect(after.ogUrl).toBe(`http://${host}:3000/`);
    expect(after.ogImage).toBe(`http://${host}:3000/og?v=${ms}`);
    expect(metaContents(res.text, "og:title")).toEqual(["Custom host, after Publish"]);
    const image = await rawBuffer(host, "/og");
    expect(image.body.equals(imageBefore)).toBe(false);
    expect(pngSizeOf(image.body)).toEqual({ width: 1200, height: 630 });
    // The handle host serves the very same picture.
    expect(image.body.equals((await ogOf(user.handle)).body)).toBe(true);
  });
});

test.describe("M6-32 abuse: a draft written with the publishable key cannot reach the live page", () => {
  test("M6-32 another user's path, a URL, a path with .. and a 10 000-character title are each refused at Publish; the tags and /og stay as they were", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough: it drives one editor");
    const user = await seededUser(context, "ma1");
    const other = await makeUser("ma1b");
    await openEditor(page);
    const token = await accessToken(context);
    const before = await pageRow(user.pageId);
    const tagsBefore = (await liveTags(user.handle)).tags;
    const imageBefore = (await ogOf(user.handle)).body;

    const crafted: [string, unknown, RegExp][] = [
      [
        "a path in another user's folder",
        {
          title: "",
          description: "",
          image: { path: `${other.id}/img-0123456789ab.webp`, width: 1200, height: 630 },
        },
        /That image isn’t in your uploads\. Upload it again\./,
      ],
      [
        "a URL",
        {
          title: "",
          description: "",
          image: { path: "https://evil.example/x.png", width: 1200, height: 630 },
        },
        /Not a valid image reference\./,
      ],
      [
        "a path with ..",
        {
          title: "",
          description: "",
          image: {
            path: `${user.userId}/../${other.id}/img-0123456789ab.webp`,
            width: 1200,
            height: 630,
          },
        },
        /Not a valid image reference\./,
      ],
      [
        "a 10 000-character title",
        { title: "x".repeat(10_000), description: "", image: null },
        /Use 70 characters or fewer\./,
      ],
    ];
    for (const [label, share, message] of crafted) {
      // The owner's own JWT and the publishable key, the way curl would: the database accepts the draft.
      const write = await userClient(token)
        .from("pages")
        .update({ draft: { ...before.draft, share } })
        .eq("id", user.pageId)
        .select("id");
      expect(write.error, `${label}: the draft is accepted by the database`).toBeNull();
      expect(write.data).toHaveLength(1);

      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: message }).first(), label).toBeVisible(
        { timeout: 30_000 },
      );
      // The live page is exactly what it was.
      expect((await pageRow(user.pageId)).published, label).toEqual(before.published);
      expect((await liveTags(user.handle)).tags, label).toEqual(tagsBefore);
      expect((await ogOf(user.handle)).body.equals(imageBefore), label).toBe(true);
    }
  });
});

test.describe("M6-32 the page itself is unchanged by the share fields", () => {
  const withShare = docWith({ title: "A share title", description: "A share description" });

  const normalize = (html: string, pageId: string) =>
    (/<div class="pg-root"[\s\S]*?<\/footer><\/div><\/div>/.exec(html)?.[0] ?? html)
      .split(pageId)
      .join("PAGE");

  test("M6-32 the markup of a page with all three share fields equals the same page without them", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const plain = await publishedPage("mu1", docWith());
    const shared = await publishedPage("mu2", withShare);
    const ref = await storeImage(shared.userId, await splitImage(1600, 800), {
      width: 1600,
      height: 800,
    });
    stored.push(ref.path);
    await republish(shared.pageId, { ...withShare, share: { ...withShare.share, image: ref } });
    const a = await tenantGet(plain.handle);
    const b = await tenantGet(shared.handle);
    expect(normalize(b.text, shared.pageId)).toBe(normalize(a.text, plain.pageId));
  });

  test("M6-32 at 390x844 and 1440x900 the page is unchanged: no sideways scroll, 44px anchors, a 480px column", async ({
    page,
  }, info) => {
    const live = await publishedPage(`mu3${info.project.name.slice(0, 1)}`, withShare);
    await page.goto(live.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mara Okafor");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "a");
    if (info.project.name === "desktop") {
      const column = await page.locator("[data-page-root]").evaluate((root) => {
        const main = root.querySelector("main, [data-page-column]") ?? root.firstElementChild!;
        return main.getBoundingClientRect().width;
      });
      expect(column).toBeLessThanOrEqual(480);
      const html = await (await page.request.get(live.url)).text();
      expect(metaContents(html, "og:title")).toEqual(["A share title"]);
    }
  });
});
