import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, signedInUser } from "../fixtures/data";
import { McpClient, cleanupMintedClients, mintToken, readWholeBody } from "../fixtures/mcp-client";
import { expectNoHorizontalScroll, url } from "../helpers";

/**
 * M18-13, the roadmap's stage 4 accept: an AI client works a post from nothing to live through the
 * MCP endpoint alone. The real server, the real database, the real writer and the real cache; a
 * minted token stands in for the OAuth dance (m10/flow.spec.ts is the dance). Runs at 390x844 and
 * 1440x900: the wire calls are the same, the live page is opened in each.
 *
 * The site is a fresh tenant of its own (never the seeded demo tenant, which other specs read).
 */

test.afterAll(async () => {
  await cleanupUsers();
  await cleanupMintedClients();
});

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const entryRow = async (id: string) => {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("rev, draft, published, published_at, live_slug")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as {
    rev: number;
    draft: Record<string, unknown>;
    published: Record<string, unknown> | null;
    published_at: string | null;
    live_slug: string | null;
  };
};

test("M18-13 an AI client turns the blog on, writes a post, edits it by exact replace, reads it back in two ranges, publishes it and sees it live", async ({
  context,
  page,
}) => {
  const user = await signedInUser(context, { label: "m18-flow", plan: "pro" });
  const mcp = new McpClient((await mintToken(user.userId)).token);
  await mcp.initialize();
  expect(await mcp.listTools()).toHaveLength(31);

  // 1. The blog is off on a new site: turn it on.
  const types = await mcp.call("list_content_types", { pageId: user.pageId });
  expect(types.types).toHaveLength(1);
  expect(types.types[0]).toMatchObject({ type: "post", enabled: false });
  const blog = await mcp.call("update_content_type", { pageId: user.pageId, enabled: true });
  expect(blog).toMatchObject({ type: "post", enabled: true });
  const archivePath = blog.archivePath as string;
  expect(archivePath).toMatch(/^[a-z0-9-]+$/);

  // 2. Create a post. The body is long enough for two ranges and holds what a careless reader
  // would lose: astral characters, CRLF, trailing spaces.
  // 360 paragraphs: about 22,600 characters, so the default range of 12,000 reads it in two.
  const filler = Array.from(
    { length: 360 },
    (_, index) => `Paragraph ${index} of the kiln log, written before the edit. 😀  \r\n\r\n`,
  ).join("");
  const original = `Opening line BEFORE-THE-EDIT of the post.\r\n\r\n${filler}Closing line.   `;
  expect(Array.from(original).length).toBeGreaterThan(12_000);
  expect(Array.from(original).length).toBeLessThan(24_000);
  const created = await mcp.call("create_entry", {
    pageId: user.pageId,
    title: "Notes from the kiln",
    body: original,
    excerpt: "What came out of the kiln this week.",
  });
  expect(created).toMatchObject({ rev: 1, status: "draft", slug: "notes-from-the-kiln" });
  expect(created.contentHash).toBe(sha256(original));
  const entryId = created.id as string;
  const listed = await mcp.call("list_entries", { pageId: user.pageId });
  expect(listed.entries).toEqual([
    expect.objectContaining({ id: entryId, status: "draft", title: "Notes from the kiln", rev: 1 }),
  ]);

  // 3. Edit the body by exact replace.
  const edited = await mcp.call("update_entry", {
    entryId,
    ifRev: created.rev,
    bodyEdits: [{ find: "BEFORE-THE-EDIT", replace: "AFTER-THE-EDIT" }],
  });
  const expected = original.replace("BEFORE-THE-EDIT", "AFTER-THE-EDIT");
  expect(edited).toMatchObject({ rev: 2, unchanged: false });
  expect(edited.contentHash).toBe(sha256(expected));

  // 4. Read it back in two ranges and compare byte for byte, with the hash.
  const read = await readWholeBody(mcp, entryId);
  expect(read.calls).toBe(2);
  expect(read.bodyChars).toBe(Array.from(expected).length);
  expect(Buffer.from(read.body, "utf8").equals(Buffer.from(expected, "utf8"))).toBe(true);
  expect(sha256(read.body)).toBe(read.contentHash);
  expect(read.contentHash).toBe(sha256(expected));
  expect(read.rev).toBe(2);

  // 5. A stale ifRev is refused, nothing is written, and the answer holds no rev to retry with.
  const stale = await mcp.callFailure("update_entry", {
    entryId,
    ifRev: 1,
    title: "Written from a stale read",
  });
  expect(stale).toEqual({
    code: "conflict",
    message: "This changed while I was working on it. Call get_entry again and redo the change.",
  });
  expect((await entryRow(entryId)).draft.title).toBe("Notes from the kiln");

  // Nothing is live yet.
  const liveAddress = url(user.handle, `/${archivePath}/notes-from-the-kiln`);
  expect((await fetch(liveAddress)).status).toBe(404);
  expect((await entryRow(entryId)).published).toBeNull();

  // 6. Publish it, and see the edited text on the live page at once.
  const published = await mcp.call("publish_entry", { entryId, ifRev: 2 });
  expect(published).toMatchObject({ published: true, type: "post", id: entryId });
  expect(published.url).toBe(liveAddress);
  const response = await page.goto(liveAddress);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Notes from the kiln" })).toBeVisible();
  await expect(page.getByText("Opening line AFTER-THE-EDIT of the post.")).toBeVisible();
  await expect(page.getByText("BEFORE-THE-EDIT")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  const row = await entryRow(entryId);
  expect(row.published?.body).toBe(expected);
  expect(row.live_slug).toBe("notes-from-the-kiln");
  const after = await mcp.call("get_entry", { entryId, length: 1 });
  expect(after).toMatchObject({
    status: "published",
    hasUnpublishedChanges: false,
    liveUrl: liveAddress,
  });

  // 7. A later draft edit is not live until the next publish_entry.
  const again = await mcp.call("update_entry", {
    entryId,
    ifRev: published.rev,
    bodyEdits: [{ find: "AFTER-THE-EDIT", replace: "NOT-LIVE-YET" }],
  });
  expect(again.unchanged).toBe(false);
  expect(await (await fetch(liveAddress)).text()).not.toContain("NOT-LIVE-YET");

  // 8. An old-style publish_page call (only pageId) still publishes the site's design and pages,
  // and still publishes no post.
  const bio = `Bio published the old way ${Date.now()}`;
  await mcp.call("update_profile", { pageId: user.pageId, bio });
  expect(await (await fetch(url(user.handle))).text()).not.toContain(bio);
  const whole = await mcp.call("publish_page", { pageId: user.pageId });
  expect(whole).toMatchObject({ published: true, url: url(user.handle).replace(/\/$/, "") });
  expect(await (await fetch(url(user.handle))).text()).toContain(bio);
  const post = await (await fetch(liveAddress)).text();
  expect(post).toContain("AFTER-THE-EDIT");
  expect(post).not.toContain("NOT-LIVE-YET");
});
