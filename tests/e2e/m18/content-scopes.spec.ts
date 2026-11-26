import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, signedInUser } from "../fixtures/data";
import {
  McpClient,
  READ_WRITE_SCOPES,
  cleanupMintedClients,
  mintToken,
  readWholeBody,
} from "../fixtures/mcp-client";
import { url } from "../helpers";

/**
 * M18-13, the other two ends of the client flow: a connection allowed to read and write but not to
 * publish stops at `publish_entry`, and nothing goes live; and with another person's token every id
 * of the first person is `not_found`. The real server and database; minted tokens.
 */

test.afterAll(async () => {
  await cleanupUsers();
  await cleanupMintedClients();
});

/** Turns the blog on the way the person would in the app (a write-only connection cannot). */
async function blogOn(siteId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("content_types")
    .update({ enabled: true })
    .eq("site_id", siteId)
    .eq("key", "post")
    .select("archive_path")
    .single();
  if (error) throw new Error(`switching the blog on failed: ${error.message}`);
  return data.archive_path as string;
}

const entryRow = async (id: string) => {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("rev, draft, published, published_at, live_slug, deleted_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
};

test("M18-13 the same flow with a read and write token stops at publish_entry with insufficient_scope, and the post is not live", async ({
  context,
}) => {
  const user = await signedInUser(context, { label: "m18-rw", plan: "pro" });
  const mcp = new McpClient((await mintToken(user.userId, READ_WRITE_SCOPES)).token);
  await mcp.initialize();

  // The blog setting changes the live site: this connection may not touch it.
  const setting = await mcp.callFailure("update_content_type", {
    pageId: user.pageId,
    enabled: true,
  });
  expect(setting).toMatchObject({ code: "insufficient_scope", requiredScope: "hydlnk.publish" });
  const archivePath = await blogOn(user.pageId);

  // Drafting works: create, edit by exact replace, read back.
  const created = await mcp.call("create_entry", {
    pageId: user.pageId,
    title: "A draft that stays a draft",
    body: "First line BEFORE.\n\nSecond line.",
  });
  const entryId = created.id as string;
  const edited = await mcp.call("update_entry", {
    entryId,
    ifRev: created.rev,
    bodyEdits: [{ find: "BEFORE", replace: "AFTER" }],
  });
  const read = await readWholeBody(mcp, entryId);
  expect(read.body).toBe("First line AFTER.\n\nSecond line.");
  expect(read.calls).toBe(1);

  // Publishing stops here, with the step-up challenge, and nothing is live.
  const outcome = await mcp.callTool("publish_entry", { entryId, ifRev: edited.rev });
  expect(outcome.isError).toBe(true);
  expect(outcome.structured.error).toMatchObject({
    code: "insufficient_scope",
    requiredScope: "hydlnk.publish",
  });
  expect(String((outcome.structured.error as { message: string }).message)).toContain(
    "Publish your pages and posts",
  );
  const challenge = (outcome.meta as Record<string, string[]>)["mcp/www_authenticate"]![0]!;
  expect(challenge).toContain('scope="hydlnk.publish"');
  const row = await entryRow(entryId);
  expect(row.published).toBeNull();
  expect(row.published_at).toBeNull();
  expect(row.rev).toBe(edited.rev);
  const live = await fetch(url(user.handle, `/${archivePath}/a-draft-that-stays-a-draft`));
  expect(live.status).toBe(404);

  // Every other tool that changes the live site is refused the same way.
  for (const [name, args] of [
    ["unpublish_entry", { entryId, ifRev: edited.rev }],
    ["publish_design", { pageId: user.pageId, ifDesignRev: "1" }],
    ["publish_page", { pageId: user.pageId }],
    ["rename_term", { pageId: user.pageId, termId: entryId, name: "x" }],
    ["delete_term", { pageId: user.pageId, termId: entryId }],
  ] as const) {
    const failure = await mcp.callFailure(name, args);
    expect(failure.code, name).toBe("insufficient_scope");
    expect(failure.requiredScope, name).toBe("hydlnk.publish");
  }
  // A draft post can still be put in the trash and brought back: that changes nothing live.
  const trashed = await mcp.call("delete_entry", { entryId, ifRev: edited.rev });
  expect(trashed).toMatchObject({ status: "trashed", wasLive: false });
  const restored = await mcp.call("restore_entry", { entryId, ifRev: trashed.rev });
  expect(restored).toMatchObject({ status: "draft" });
});

test("M18-13 with another person's token every id of the first person is not_found", async ({
  browser,
  context,
}) => {
  const a = await signedInUser(context, { label: "m18-own", plan: "pro" });
  const otherContext = await browser.newContext();
  const b = await signedInUser(otherContext, { label: "m18-oth", plan: "pro" });
  await otherContext.close();
  await blogOn(a.pageId);
  await blogOn(b.pageId);

  const owner = new McpClient((await mintToken(a.userId)).token);
  await owner.initialize();
  const post = await owner.call("create_entry", {
    pageId: a.pageId,
    title: "A-ONLY-TITLE-m18",
    body: "A-ONLY-BODY-m18",
  });
  const live = await owner.call("publish_entry", { entryId: post.id, ifRev: post.rev });
  const trashed = await owner.call("create_entry", { pageId: a.pageId, title: "In A's trash" });
  const inTrash = await owner.call("delete_entry", { entryId: trashed.id, ifRev: trashed.rev });
  const term = (
    await owner.call("create_term", { pageId: a.pageId, taxonomy: "tag", name: "A tag" })
  ).term as { id: string };
  const before = [await entryRow(post.id as string), await entryRow(trashed.id as string)];

  const stranger = new McpClient((await mintToken(b.userId)).token);
  await stranger.initialize();
  const ENTRY =
    "We couldn’t find that. Call list_entries to see your posts, or list_pages for pages.";
  const PAGE = "We couldn’t find that page. Call list_pages to see your pages.";
  const TERM = "We couldn’t find that category or tag. Call list_terms.";
  const calls: Array<[string, Record<string, unknown>, string]> = [
    // A's site id.
    ["list_content_types", { pageId: a.pageId }, PAGE],
    ["list_entries", { pageId: a.pageId }, PAGE],
    ["list_terms", { pageId: a.pageId }, PAGE],
    ["create_entry", { pageId: a.pageId, title: "Planted" }, PAGE],
    ["create_term", { pageId: a.pageId, taxonomy: "tag", name: "Planted" }, PAGE],
    ["publish_design", { pageId: a.pageId, ifDesignRev: "1" }, PAGE],
    ["update_content_type", { pageId: a.pageId, enabled: false }, PAGE],
    ["rename_term", { pageId: a.pageId, termId: term.id, name: "Taken" }, PAGE],
    ["delete_term", { pageId: a.pageId, termId: term.id }, PAGE],
    // A's post id, alone and with either site id.
    ["get_entry", { entryId: post.id }, ENTRY],
    ["get_entry", { entryId: post.id, pageId: a.pageId }, ENTRY],
    ["get_entry", { entryId: post.id, pageId: b.pageId }, ENTRY],
    ["update_entry", { entryId: post.id, ifRev: live.rev, title: "Taken" }, ENTRY],
    ["delete_entry", { entryId: post.id, ifRev: live.rev }, ENTRY],
    ["unpublish_entry", { entryId: post.id, ifRev: live.rev }, ENTRY],
    ["publish_entry", { entryId: post.id, ifRev: live.rev }, ENTRY],
    ["list_revisions", { entryId: post.id }, ENTRY],
    ["restore_revision", { entryId: post.id, revision: 1, ifRev: live.rev }, ENTRY],
    ["restore_entry", { entryId: trashed.id, ifRev: inTrash.rev }, ENTRY],
    // A's pages through the tools that take a page.
    ["publish_entry", { pageId: a.pageId, ifRev: 1 }, ENTRY],
    ["list_revisions", { pageId: a.pageId }, ENTRY],
    // A's term id under the stranger's own site.
    ["rename_term", { pageId: b.pageId, termId: term.id, name: "Taken" }, TERM],
    ["delete_term", { pageId: b.pageId, termId: term.id }, TERM],
  ];
  for (const [name, args, message] of calls) {
    const outcome = await stranger.callTool(name, args);
    expect(outcome.isError, name).toBe(true);
    expect(outcome.structured.error, `${name} ${JSON.stringify(args)}`).toEqual({
      code: "not_found",
      message,
    });
    const text = JSON.stringify(outcome.raw);
    expect(text, name).not.toContain("A-ONLY-TITLE-m18");
    expect(text, name).not.toContain("A-ONLY-BODY-m18");
  }
  // A's term in the stranger's own post is refused as input, and nothing of A's is in their lists.
  const own = await stranger.call("create_entry", { pageId: b.pageId, title: "B's own" });
  const planted = await stranger.callFailure("update_entry", {
    entryId: own.id,
    ifRev: own.rev,
    tags: [term.id],
  });
  expect(planted.code).toBe("invalid_input");
  const lists = JSON.stringify([
    await stranger.call("list_entries", { pageId: b.pageId }),
    await stranger.call("list_entries", { pageId: b.pageId, q: "A-ONLY", status: "published" }),
    await stranger.call("list_terms", { pageId: b.pageId }),
  ]);
  expect(lists).not.toContain("A-ONLY");
  expect(lists).not.toContain(term.id);

  // Everything of A's is exactly as it was.
  expect([await entryRow(post.id as string), await entryRow(trashed.id as string)]).toEqual(before);
  const terms = await adminClient().from("content_terms").select("name").eq("id", term.id).single();
  expect(terms.data?.name).toBe("A tag");
});
