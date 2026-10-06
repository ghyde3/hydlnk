import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import {
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  rand,
  signedInUser,
  uniq,
} from "../fixtures/data";
import {
  McpClient,
  READ_ONLY_SCOPES,
  READ_WRITE_SCOPES,
  cleanupMintedClients,
  mintToken,
} from "../fixtures/mcp-client";
import { openEditor, pageRow, saveIndicator } from "../m2/editor-helpers";
import { prepareFlowUser, runEveryTool } from "./mcp-flow-helpers";

/**
 * Wave L, an AI client working a page through all fourteen tools (M10-24 to M10-32), end to end: the
 * real server, the real database, the real publish gate and the real cache. A minted token stands in
 * for the OAuth dance (flow.spec.ts is the dance). Every result is checked for the documented shape
 * and for nothing internal; at the end the activity log holds exactly one row per call.
 */

test.afterAll(async () => {
  await cleanupUsers();
  await cleanupMintedClients();
});
test.beforeEach(({}, info) =>
  test.skip(!desktopOnly(info), "pure HTTP and API rows: desktop only"),
);

test("M10-33 the fourteen tools in the order an AI would use them, on a Pro page, then publish and see it live at once", async ({
  context,
  page,
}) => {
  const user = await prepareFlowUser(context, "mcp-flow");
  const minted = await mintToken(user.userId);
  const mcp = new McpClient(minted.token);
  await runEveryTool({
    context,
    page,
    user,
    mcp,
    clientId: minted.clientId,
    grantId: minted.grantId,
  });
});

test("M10-23 a tool write while an editor tab is open: the tab's next save is the 'changed in another tab' state and the tool's block is stored", async ({
  context,
  page,
}) => {
  const user = await signedInUser(context, { label: "mcp-tab", plan: "pro" });
  const token = await mintToken(user.userId);
  const mcp = new McpClient(token.token);
  await mcp.initialize();
  await openEditor(page);
  const added = await mcp.call<{ blockId: string; rev: number }>("add_block", {
    pageId: user.pageId,
    type: "header",
    fields: { text: "Added by a tool" },
  });
  // The tab still holds the old rev: the next autosave matches no row, never merging over the tool's write.
  await page.getByLabel("Bio", { exact: true }).fill(`typed in the tab ${rand(4)}`);
  await expect(
    page.getByText("This page changed in another tab. Reload to keep editing."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(saveIndicator(page)).toHaveText("Not saved");
  const stored = await pageRow(user.pageId);
  expect(stored.draft.blocks.some((block) => block.id === added.blockId)).toBe(true);
  expect(stored.draft.profile.bio).not.toMatch(/typed in the tab/);
  // And a tool call with a stale ifRev after an editor save is a conflict that writes nothing.
  const before = await pageRow(user.pageId);
  const failure = await mcp.callFailure("add_block", {
    pageId: user.pageId,
    ifRev: before.draft.rev - 1,
    type: "header",
    fields: { text: "Stale" },
  });
  expect(failure.code).toBe("conflict");
  expect((await pageRow(user.pageId)).draft).toEqual(before.draft);
});

test("M10-23 two add_block calls started together never both write from the same rev: 20 rounds, blocks added equal successes, rev rises by exactly that", async () => {
  const user = await makeUser("mcp-race", { plan: "pro" });
  const pageId = await insertPage(user.id, uniq("race"));
  // Two tokens of one person, so the per-token limit (30 a minute) is not what ends the loop.
  const first = new McpClient((await mintToken(user.id)).token);
  const second = new McpClient((await mintToken(user.id)).token);
  await Promise.all([first.initialize(), second.initialize()]);
  const blocks = async () => (await pageRow(pageId)).draft;
  let before = await blocks();
  let added = 0;
  let conflicts = 0;
  for (let round = 0; round < 20; round++) {
    const outcomes = await Promise.all(
      [first, second].map((client, index) =>
        client.callTool("add_block", {
          pageId,
          type: "header",
          fields: { text: `Round ${round} caller ${index}` },
        }),
      ),
    );
    const wins = outcomes.filter((outcome) => !outcome.isError).length;
    const losses = outcomes.filter((outcome) => outcome.isError);
    // At least one writes; a loser is a conflict, never a half write or another kind of failure.
    expect(wins, `round ${round}`).toBeGreaterThanOrEqual(1);
    for (const loss of losses) {
      expect((loss.structured.error as { code?: string } | undefined)?.code).toBe("conflict");
    }
    conflicts += losses.length;
    const after = await blocks();
    expect(after.blocks.length - before.blocks.length, `round ${round}`).toBe(wins);
    expect(after.rev - before.rev, `round ${round}`).toBe(wins);
    added += wins;
    before = after;
  }
  expect(added).toBeGreaterThanOrEqual(20);
  expect(added + conflicts).toBe(40);
});

test("M10-22 scopes, suspension and the limits, over the wire", async () => {
  const user = await makeUser("mcp-guards", { plan: "pro" });
  const pageId = await insertPage(user.id, uniq("guards"));
  const reader = new McpClient((await mintToken(user.id, READ_ONLY_SCOPES)).token);
  await reader.initialize();
  const denied = await reader.callTool("add_block", {
    pageId,
    type: "header",
    fields: { text: "x" },
  });
  expect(denied.isError).toBe(true);
  expect(denied.structured.error).toMatchObject({
    code: "insufficient_scope",
    requiredScope: "hydlnk.write",
  });
  expect((denied.meta!["mcp/www_authenticate"] as string[])[0]).toMatch(
    /^Bearer error="insufficient_scope", scope="hydlnk\.write", resource_metadata="http:\/\/app\.localhost:3000\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
  const writer = new McpClient((await mintToken(user.id, READ_WRITE_SCOPES)).token);
  await writer.initialize();
  const noPublish = await writer.callFailure("publish_page", { pageId });
  expect(noPublish).toMatchObject({ code: "insufficient_scope", requiredScope: "hydlnk.publish" });
  expect(
    (await adminClient().from("pages").select("published_at").eq("id", pageId).single()).data!
      .published_at,
  ).toBeNull();

  // Suspension takes effect on the second call; initialize and tools/list still work.
  await writer.call("get_page", { pageId });
  await adminClient()
    .from("accounts")
    .update({ suspended_at: new Date().toISOString() })
    .eq("id", user.id);
  expect(await writer.listTools()).toHaveLength(14);
  for (const [tool, args] of [
    ["list_pages", {}],
    ["get_page", { pageId }],
    ["add_block", { pageId, type: "divider" }],
    ["publish_page", { pageId }],
  ] as const) {
    const failure = await (
      tool === "publish_page" ? new McpClient((await mintToken(user.id)).token) : writer
    ).callFailure(tool, args);
    expect(failure, tool).toMatchObject({
      code: "account_suspended",
      message: "Your account is suspended. Contact support to appeal.",
    });
  }
});

test("M10-22 rate limits: 60 list_pages calls a minute for one person, the 61st is rate_limited, another person is unaffected", async () => {
  const a = await makeUser("mcp-rate-a", { plan: "pro" });
  const b = await makeUser("mcp-rate-b", { plan: "pro" });
  await insertPage(a.id, uniq("rate-a"));
  await insertPage(b.id, uniq("rate-b"));
  // Two tokens of one person: the per-token limit is 30 a minute, the per-person limit 60.
  const one = new McpClient((await mintToken(a.id)).token);
  const two = new McpClient((await mintToken(a.id)).token);
  await one.initialize();
  await two.initialize();
  for (let n = 1; n <= 60; n++) {
    const outcome = await (n % 2 === 0 ? one : two).callTool("list_pages");
    expect(outcome.isError, `call ${n}`).toBe(false);
  }
  const blocked = await one.callFailure("list_pages");
  expect(blocked.code).toBe("rate_limited");
  expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  expect(blocked.message).toMatch(/^You’re going too fast\. Try again in \d+ seconds?\.$/);
  const second = new McpClient((await mintToken(b.id)).token);
  await second.initialize();
  expect((await second.callTool("list_pages")).isError).toBe(false);
  // initialize and tools/list are never counted.
  expect(await one.listTools()).toHaveLength(14);
});

test("M10-32 the activity log: rows per token with their own client, a deleted page leaves null, deleting the person removes them", async () => {
  const user = await makeUser("mcp-log", { plan: "pro" });
  const pageId = await insertPage(user.id, uniq("log"));
  const first = await mintToken(user.id, undefined, { clientName: "First app" });
  const second = await mintToken(user.id, undefined, { clientName: "Second app" });
  const a = new McpClient(first.token);
  const b = new McpClient(second.token);
  await a.initialize();
  await b.initialize();
  await a.call("get_page", { pageId });
  await b.call("get_page", { pageId });
  await a.call("list_pages");
  const stranger = await makeUser("mcp-log-b", { plan: "pro" });
  const other = new McpClient((await mintToken(stranger.id)).token);
  await other.initialize();
  await other.call("list_pages");
  await new Promise((resolve) => setTimeout(resolve, 600));
  const admin = adminClient();
  const rows = (await admin.from("mcp_activity").select("*").eq("user_id", user.id).order("id"))
    .data!;
  expect(rows.map((row) => [row.tool, row.client_id, row.grant_id])).toEqual([
    ["get_page", first.clientId, first.grantId],
    ["get_page", second.clientId, second.grantId],
    ["list_pages", first.clientId, first.grantId],
  ]);
  expect(
    (await admin.from("mcp_activity").select("id").eq("user_id", stranger.id)).data,
  ).toHaveLength(1);
  // A deleted page leaves the rows with a null page id; deleting the person removes them.
  await admin.from("pages").delete().eq("id", pageId);
  expect(
    (
      await admin
        .from("mcp_activity")
        .select("page_id")
        .eq("user_id", user.id)
        .eq("tool", "get_page")
    ).data!.every((row) => row.page_id === null),
  ).toBe(true);
  await admin.auth.admin.deleteUser(user.id);
  expect((await admin.from("mcp_activity").select("id").eq("user_id", user.id)).data).toEqual([]);
  expect(
    (await admin.from("mcp_activity").select("id").eq("user_id", stranger.id)).data,
  ).toHaveLength(1);
});

test("M10-24 two people calling at once over HTTP each get only their own pages", async () => {
  const a = await makeUser("mcp-par-a", { plan: "pro" });
  const b = await makeUser("mcp-par-b", { plan: "pro" });
  const pageA = await insertPage(a.id, uniq("par-a"));
  const pageB = await insertPage(b.id, uniq("par-b"));
  const one = new McpClient((await mintToken(a.id)).token);
  const two = new McpClient((await mintToken(b.id)).token);
  await one.initialize();
  await two.initialize();
  for (let round = 0; round < 10; round++) {
    const [ra, rb] = await Promise.all([
      one.call<{ pages: Array<{ id: string }> }>("list_pages"),
      two.call<{ pages: Array<{ id: string }> }>("list_pages"),
    ]);
    expect(ra.pages.map((entry) => entry.id)).toEqual([pageA]);
    expect(rb.pages.map((entry) => entry.id)).toEqual([pageB]);
  }
});
