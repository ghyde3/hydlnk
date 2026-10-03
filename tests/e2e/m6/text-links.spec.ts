import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, makeUser, rand } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { DAY_MS, dayAt, makeOwner, seed, signInOwner } from "../m4/analytics-dash-helpers";
import { insertPage } from "../fixtures/data";
import { rawBuffer } from "../m2/publish-helpers";
import { url } from "../helpers";
import {
  L1,
  L2,
  L3,
  TEXT_ID,
  accessToken,
  bold,
  draftWith,
  italic,
  link,
  textBlock,
  userWithBlocks,
} from "./text-helpers";

const domains: string[] = [];
test.afterAll(async () => {
  if (domains.length > 0)
    await adminClient().from("blocked_domains").delete().in("domain", domains);
  await cleanupUsers();
});
test.describe.configure({ timeout: 120_000 });

/**
 * M6-29: the click redirect resolves a link inside a text block from the PUBLISHED document only,
 * counts it under its own id, names it in Clicks by link, and the blocklist and the limits hold
 * against writes made straight through the publishable key.
 */

const clickRows = async (pageId: string, blockId?: string) => {
  let query = adminClient()
    .from("events")
    .select("id, block_id, type")
    .eq("page_id", pageId)
    .eq("type", "click");
  if (blockId) query = query.eq("block_id", blockId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

/** A page that is live with `published` (a document written with the secret key), and its draft. */
async function liveWith(label: string, draftBlocks: unknown[], publishedBlocks?: unknown[]) {
  const user = await makeUser(label);
  const handle = `zq-${label}-${rand(5)}`;
  const { toPublishForm } = await import("@/lib/document");
  const draft = draftWith(handle, draftBlocks);
  const form = toPublishForm(publishedBlocks ? draftWith(handle, publishedBlocks) : draft, null);
  const pageId = await insertPage(user.id, handle, {
    draft,
    published: form,
    published_at: new Date().toISOString(),
  });
  return { user, handle, pageId, form };
}

const host = (handle: string) => `${handle}.localhost:3000`;
/** A real browser's user agent: a click from nothing (curl, no header) is not counted. */
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

test.describe("M6-29 the click redirect for a link in text", () => {
  test("M6-29 302 to exactly the published URL, no-store, no cookie, one click row under the link's id", async () => {
    const block = textBlock("Book a session now", [
      bold(0, 4),
      link(5, 14, L1, "https://example.com/book?x=1&y=%C3%A9"),
    ]);
    const { handle, pageId } = await liveWith("tlc1", [block]);
    const res = await rawBuffer(host(handle), `/r/${pageId}/${L1}`, {
      headers: { "user-agent": PHONE_UA },
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/book?x=1&y=%C3%A9");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["set-cookie"]).toBeUndefined();
    await expect
      .poll(async () => (await clickRows(pageId, L1)).length, { timeout: 15_000 })
      .toBe(1);
    const rows = await clickRows(pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ block_id: L1, type: "click" });
  });

  test("M6-29 only the published document counts: a draft-only link, a hidden text block, an unknown id, the text block and a bold or italic mark are all 404 and record nothing", async () => {
    const published = textBlock("Book a session now", [bold(0, 4), italic(5, 6), link(7, 14, L1)]);
    const hidden = textBlock(
      "Hidden words here",
      [link(0, 6, L2, "https://hidden.example/x")],
      { visible: false },
      "text-hidden-001",
    );
    // The draft has a link the page does not publish yet.
    const draftOnly = textBlock(
      "Another sentence",
      [link(0, 7, L3, "https://draft.example/x")],
      {},
      "text-draftonly1",
    );
    const { handle, pageId } = await liveWith(
      "tlc2",
      [published, hidden, draftOnly],
      [published, hidden],
    );
    const ok = await rawBuffer(host(handle), `/r/${pageId}/${L1}`, {
      headers: { "user-agent": PHONE_UA },
    });
    expect(ok.status).toBe(302);
    for (const id of [L2, L3, "nobody-here-1", TEXT_ID, "text-hidden-001", "text-draftonly1"]) {
      const res = await rawBuffer(host(handle), `/r/${pageId}/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.headers.location, id).toBeUndefined();
    }
    // Wait for the one real click to land, then make sure nothing else did.
    await expect.poll(async () => (await clickRows(pageId)).length, { timeout: 15_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await clickRows(pageId)).map((row) => row.block_id)).toEqual([L1]);
  });

  test("M6-29 a link mark whose stored URL has another scheme is 404, and so are the open-redirect tricks", async () => {
    const block = textBlock("Book a session now", [link(5, 14, L1, "https://example.com/book")]);
    const { handle, pageId, form } = await liveWith("tlc3", [block]);
    // The open-redirect parameters and a different Host never change Location.
    const tricky = await rawBuffer(
      host(handle),
      `/r/${pageId}/${L1}?url=https://evil.example&to=//evil.example&next=https://evil.example`,
      {
        headers: {
          "user-agent": PHONE_UA,
          "x-forwarded-host": "evil.example",
          referer: "https://evil.example/",
        },
      },
    );
    expect(tricky.status).toBe(302);
    expect(tricky.headers.location).toBe("https://example.com/book");
    const elsewhere = await rawBuffer(`evil-${rand(5)}.localhost:3000`, `/r/${pageId}/${L1}`);
    expect(elsewhere.status).toBe(404);
    const marketing = await rawBuffer("localhost:3000", `/r/${pageId}/${L1}`);
    expect(marketing.status).toBe(404);

    // The published document is changed to a hostile link behind the schema's back.
    const tampered = JSON.parse(JSON.stringify(form)) as { blocks: { marks: { url: string }[] }[] };
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "https://user@host.example/",
    ]) {
      tampered.blocks[0]!.marks[0]!.url = hostile;
      const { error } = await adminClient()
        .from("pages")
        .update({ published: tampered })
        .eq("id", pageId);
      expect(error).toBeNull();
      // A tenant page is cached after its first render; a click always reads the current document.
      const res = await rawBuffer(host(handle), `/r/${pageId}/${L1}`);
      expect(res.status, hostile).toBe(404);
      expect(res.headers.location, hostile).toBeUndefined();
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    // The one good click above (with the open-redirect parameters) is the only row.
    expect((await clickRows(pageId)).length).toBeLessThanOrEqual(1);
  });

  test("M6-29 a link mark of one user's page cannot be resolved through another page", async () => {
    const mine = await liveWith("tlc4a", [
      textBlock("Alpha words here", [link(0, 5, "link-alpha-0001", "https://alpha.example/")]),
    ]);
    const theirs = await liveWith("tlc4b", [
      textBlock("Beta words here", [link(0, 4, "link-beta-00001", "https://beta.example/")]),
    ]);
    const crossed = await rawBuffer(host(mine.handle), `/r/${mine.pageId}/link-beta-00001`);
    expect(crossed.status).toBe(404);
    const crossedPage = await rawBuffer(host(theirs.handle), `/r/${mine.pageId}/link-alpha-0001`);
    expect(crossedPage.status).toBe(404);
    const fine = await rawBuffer(host(mine.handle), `/r/${mine.pageId}/link-alpha-0001`);
    expect(fine.status).toBe(302);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await clickRows(theirs.pageId)).toEqual([]);
  });
});

test.describe("M6-29 a link in text works without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("M6-29 the anchor follows the redirect with scripting off, and the click is counted", async ({
    page,
  }) => {
    const block = textBlock("Book a session now", [
      link(5, 14, L1, "https://example.com/book?x=1"),
    ]);
    const { handle, pageId } = await liveWith("tlc5", [block]);
    await page.context().route(
      (target) => target.hostname === "example.com",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Landed</title><p>Landed</p>",
        }),
    );
    await page.goto(url(handle));
    const anchor = page.locator("p.pg-text a");
    await expect(anchor).toHaveAttribute("href", `/r/${pageId}/${L1}`);
    await anchor.click();
    await page.waitForURL("https://example.com/book?x=1");
    await expect
      .poll(async () => (await clickRows(pageId, L1)).length, { timeout: 15_000 })
      .toBe(1);
  });
});

test.describe("M6-29 Clicks by link", () => {
  test("M6-29 names a text link by its words, and shows 'Removed link' once it is gone", async ({
    page,
    context,
  }) => {
    const owner = await makeOwner("tla", "pro");
    const { toPublishForm } = await import("@/lib/document");
    const withLink = toPublishForm(
      draftWith(owner.handle, [
        textBlock("Please Book a session today", [link(7, 21, L1, "https://example.com/book")]),
      ]),
      null,
    );
    const publish = async (doc: unknown) => {
      const { error } = await adminClient()
        .from("pages")
        .update({ published: doc, published_at: new Date().toISOString() })
        .eq("id", owner.pageId);
      expect(error).toBeNull();
    };
    await publish(withLink);
    const day = dayAt(-3);
    await seed(owner.pageId, [
      ...Array.from({ length: 3 }, (_, i) => ({
        type: "click" as const,
        day,
        blockId: L1,
        visitor: `${"a".repeat(63)}${i}`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        type: "view" as const,
        day,
        visitor: `${"b".repeat(63)}${i}`,
      })),
    ]);
    await signInOwner(context, owner);
    await page.goto(url("app", "/analytics"));
    const card = page.getByTestId("links-card");
    await expect(card.getByRole("heading", { name: "Clicks by link" })).toBeVisible();
    const row = card.getByTestId("link-row").first();
    await expect(row.getByRole("cell").first()).toHaveText("Book a session");
    await expect(row).toContainText("3");

    // The link is taken out and the page republished: the old clicks read 'Removed link'.
    await publish(
      toPublishForm(draftWith(owner.handle, [textBlock("Please Book a session today")]), null),
    );
    await page.reload();
    await expect(card.getByTestId("link-row").first().getByRole("cell").first()).toHaveText(
      "Removed link",
    );
    void DAY_MS;
  });
});

test.describe("M6-29 writes made straight through the publishable key", () => {
  test("M6-29 700 link marks are accepted as a draft quickly and never published; and a 4000-character link fails Publish", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "tlab", [textBlock("Hello", [link(0, 5, L1)])]);
    const token = await accessToken(context);
    const rev = (
      (await adminClient().from("pages").select("draft").eq("id", user.pageId).single()).data!
        .draft as { rev: number }
    ).rev;

    // 700 link marks in one block.
    const many = Array.from({ length: 700 }, (_, i) =>
      link(
        i % 590,
        (i % 590) + 1,
        `link-many-${String(i).padStart(6, "0")}`,
        "https://ok.example/p",
      ),
    );
    const started = Date.now();
    const bulk = await restAs(token, `/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      body: {
        draft: { ...draftWith(user.handle, [textBlock("x".repeat(600), many)]), rev: rev + 1 },
      },
    });
    const elapsed = Date.now() - started;
    expect(bulk.status, JSON.stringify(bulk.body).slice(0, 200)).toBe(200);
    expect(elapsed, "the save finishes within 2 seconds").toBeLessThan(2000);

    // A link of 4000 characters. (A link id that repeats another block's id is covered in Vitest: the
    // editor repairs such a draft when it loads it, so the gate's sentence is never reached from here.)
    const longUrl = `https://example.com/${"a".repeat(3980)}`;
    const next = await restAs(token, `/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      body: {
        draft: {
          ...draftWith(user.handle, [textBlock("Hello world again", [link(0, 5, L1, longUrl)])]),
          rev: rev + 2,
        },
      },
    });
    expect(next.status, JSON.stringify(next.body).slice(0, 200)).toBe(200);

    const before = (
      await adminClient().from("pages").select("published").eq("id", user.pageId).single()
    ).data!.published;
    await page.goto(url("app", "/editor"));
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    const alert = page.getByRole("alert").filter({ hasText: "Fix 1 block before publishing." });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    const row = page.locator(`li[data-block-id="${TEXT_ID}"]`);
    await expect(
      row.getByText("Enter a full web address, like https://example.com.", { exact: true }),
    ).toBeVisible();
    const after = (
      await adminClient().from("pages").select("published").eq("id", user.pageId).single()
    ).data!.published;
    expect(after).toEqual(before);
  });

  test("M6-29 a link to https://good.example@<blocked host>/ is refused by the database, and the stored draft is unchanged", async ({
    context,
  }) => {
    const domain = `tl-${rand(8)}.example`;
    domains.push(domain);
    const { error: listed } = await adminClient()
      .from("blocked_domains")
      .insert({ domain, reason: "e2e" });
    expect(listed).toBeNull();
    const user = await userWithBlocks(context, "tlbl", [
      textBlock("Hello world", [link(0, 5, L1, "https://ok.example/")]),
    ]);
    const token = await accessToken(context);
    const before = (
      await adminClient().from("pages").select("draft").eq("id", user.pageId).single()
    ).data!.draft;
    const rev = (before as { rev: number }).rev;
    for (const bad of [
      `https://good.example@${domain}/`,
      `https://${domain}/x`,
      `https://sub.${domain}:8443/y`,
      `https://${domain.toUpperCase()}./z`,
    ]) {
      const res = await restAs(token, `/pages?id=eq.${user.pageId}`, {
        method: "PATCH",
        body: {
          draft: {
            ...draftWith(user.handle, [textBlock("Hello world", [link(0, 5, L1, bad)])]),
            rev: rev + 1,
          },
        },
      });
      expect(res.status, bad).toBe(400);
      expect(JSON.stringify(res.body), bad).toContain("HL005");
    }
    const after = (await adminClient().from("pages").select("draft").eq("id", user.pageId).single())
      .data!.draft;
    expect(after).toEqual(before);
  });

  test("M6-29 another user's page stays out of reach: PATCH matches no row and changes nothing", async ({
    context,
  }) => {
    const mine = await userWithBlocks(context, "tlrl", [
      textBlock("Hello world", [link(0, 5, L1)]),
    ]);
    const victim = await makeUser("tlrv");
    const victimHandle = `zq-tlrv-${rand(5)}`;
    const victimPage = await insertPage(victim.id, victimHandle, {
      draft: draftWith(victimHandle, [
        textBlock("Victim text here", [link(0, 6, L2, "https://victim.example/")]),
      ]),
    });
    const before = (await adminClient().from("pages").select("draft").eq("id", victimPage).single())
      .data!.draft;
    const res = await restAs(await accessToken(context), `/pages?id=eq.${victimPage}`, {
      method: "PATCH",
      body: {
        draft: draftWith(mine.handle, [
          textBlock("Pwned", [link(0, 5, L3, "https://evil.example/")]),
        ]),
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const after = (await adminClient().from("pages").select("draft").eq("id", victimPage).single())
      .data!.draft;
    expect(after).toEqual(before);
  });
});

export type { Page };
