/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each step checks */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { rand, signedInUser } from "../fixtures/data";
import type { ToolSession } from "../fixtures/official-mcp-client";
import { openEditor, pageRow, statusChip } from "../m2/editor-helpers";
import { url } from "../helpers";

/**
 * The shared part of the Wave L end-to-end flows (M10-24 to M10-33): a fixture user with a page whose
 * draft differs from what is live, and `runEveryTool`, which works that page through all fourteen tools
 * the way an AI would and checks every result for the documented shape and for nothing internal. The
 * minted-token spec and the real OAuth dance (flow.spec.ts) run the very same steps.
 */

// A 1x1 PNG: a real file in the page-media bucket, so the Publish gate finds it.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export async function uploadImage(
  userId: string,
  name: string,
): Promise<{ path: string; imageId: string }> {
  const path = `${userId}/${name}`;
  const { error } = await adminClient()
    .storage.from("page-media")
    .upload(path, PNG, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return { path, imageId: name };
}

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// A storage path is `{user id}/{file}`; a page's own `path` ("/specials") is documented output (M12-05).
const INTERNAL = /owner_id|stripe|sb_|hl_at_|hl_rt_|hl_ac_|page-media|"path":"[0-9a-f-]{36}\//;

/** A result must hold no uuid but the ones a tool documents (the page's own id, a domain's page id). */
export function expectNothingInternal(result: unknown, userId: string, allowed: string[]) {
  const text = JSON.stringify(result);
  expect(text).not.toContain(userId);
  expect(text).not.toMatch(INTERNAL);
  // The ids a tool documents: the page's own, a domain's page id and a theme's (set_theme takes one;
  // the system themes' ids are a fixed pattern).
  for (const found of text.match(UUID_ANYWHERE) ?? []) {
    if (/^00000000-0000-4000-8000-/.test(found)) continue;
    expect(allowed, `unexpected id ${found}`).toContain(found);
  }
}

export async function tenantHtml(handle: string, path = ""): Promise<string> {
  const response = await fetch(`http://${handle}.localhost:3000/${path}`);
  return response.text();
}

export interface FlowUser {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
  image: { path: string; imageId: string };
  /** The draft as the fixture left it: it differs from the published page. */
  rev: number;
}

/** A Pro user with a published page (a copy of the demo page) whose draft then differs from it, and an image of their own on a card. */
export async function prepareFlowUser(context: BrowserContext, label: string): Promise<FlowUser> {
  const user = await signedInUser(context, { label, plan: "pro" });
  const image = await uploadImage(user.userId, "e2eimage0001.png");
  const row = await pageRow(user.pageId);
  const draft = JSON.parse(JSON.stringify(row.draft));
  draft.blocks = draft.blocks.map((block: { id: string; type: string }) =>
    block.type === "card" ? { ...block, image: { path: image.path, width: 1, height: 1 } } : block,
  );
  draft.profile.bio = "Bio from the draft";
  draft.rev += 1;
  await adminClient().from("pages").update({ draft }).eq("id", user.pageId);
  return { ...user, image, rev: draft.rev };
}

export interface FlowEnv {
  context: BrowserContext;
  /** A page of the signed-in context, for the editor checks. */
  page: Page;
  user: FlowUser;
  /** The hand-rolled client or the official one: both give the same four calls. */
  mcp: ToolSession;
  /** The client and grant the token belongs to: every activity row must carry them. */
  clientId: string;
  grantId: string;
}

/**
 * Works the page through all fourteen tools in the order an AI would, publishes, and sees the new
 * content live on the very next request. At the end the activity log holds exactly one row per call
 * and none carries the canary text planted in the page.
 */
export async function runEveryTool(env: FlowEnv): Promise<void> {
  const admin = adminClient();
  const CANARY = `CANARY-${rand(8)}`;
  const { user } = env;
  const { page, context, mcp } = env;
  const documentedIds = [user.pageId];
  const calls: string[] = [];
  /** One line per call for the run's transcript: the tool, the argument names and the shape of the answer. */
  const transcript: string[] = [];
  const call = async <T = Record<string, any>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    calls.push(name);
    const outcome = await mcp.callTool(name, args);
    expect(outcome.isError, `${name}: ${JSON.stringify(outcome.structured.error)}`).toBe(false);
    expect(outcome.structured.ok).toBe(true);
    const answer = (outcome.json ?? {}) as Record<string, unknown>;
    // A new page's id is documented output of create_page; from then on it may appear anywhere.
    if (name === "create_page" && typeof answer.subPageId === "string") {
      documentedIds.push(answer.subPageId);
    }
    expectNothingInternal(outcome.raw, user.userId, documentedIds);
    transcript.push(
      `${name}(${Object.keys(args).join(", ")}) -> ok; keys: ${Object.keys(answer).join(", ")}` +
        (typeof answer.rev === "number" ? `; rev ${answer.rev}` : "") +
        (typeof answer.message === "string" ? `; "${answer.message}"` : ""),
    );
    return answer as T;
  };

  // The handshake and the list.
  expect((await mcp.initialize()).status).toBe(200);
  await mcp.initialized();
  const tools = await mcp.listTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    "list_pages",
    "get_page",
    "get_analytics",
    "get_domains",
    "update_profile",
    "add_block",
    "update_block",
    "move_block",
    "remove_block",
    "create_page",
    "update_page_settings",
    "set_theme",
    "create_preview_link",
    "publish_page",
  ]);

  // list_pages agrees with the editor's own status chip for the same page.
  const listed = await call<{
    account: { plan: string; pagesUsed: number };
    pages: Array<{ id: string; handle: string; publishStatus: string; address: string }>;
  }>("list_pages");
  expect(listed.account).toMatchObject({ plan: "pro", pagesUsed: 1 });
  expect(listed.pages[0]).toMatchObject({
    id: user.pageId,
    handle: user.handle,
    publishStatus: "unpublished-changes",
    address: `${user.handle}.hydlnk.com`,
  });
  await openEditor(page);
  await expect(statusChip(page)).toHaveAttribute(
    "data-publish-status",
    listed.pages[0]!.publishStatus,
  );

  // get_page: the draft, with its rev and the image's id.
  const read = await call<any>("get_page", { pageId: user.pageId });
  expect(read.page).toMatchObject({ id: user.pageId, hasUnpublishedChanges: true, rev: user.rev });
  expect(read.profile.bio).toBe("Bio from the draft");
  const card = read.blocks.find((block: { type: string }) => block.type === "card");
  expect(card.image).toEqual({ imageId: user.image.imageId, width: 1, height: 1 });
  let rev: number = read.page.rev;
  const ifRev = () => ({ pageId: user.pageId, ifRev: rev });

  // The writes.
  const profile = await call<any>("update_profile", {
    ...ifRev(),
    bio: `New bio ${CANARY}`,
    showName: true,
  });
  expect(profile.profile.bio).toBe(`New bio ${CANARY}`);
  rev = profile.rev;
  const link = await call<any>("add_block", {
    ...ifRev(),
    type: "link",
    fields: { label: "My new link", url: "https://example.com/new" },
  });
  rev = link.rev;
  const text = await call<any>("add_block", {
    ...ifRev(),
    type: "text",
    fields: { text: "A paragraph written by an assistant." },
  });
  rev = text.rev;
  const faq = await call<any>("add_block", {
    ...ifRev(),
    type: "faq",
    fields: { items: [{ question: "Is this live?", answer: "Only after publish." }] },
  });
  rev = faq.rev;
  const imageBlock = await call<any>("add_block", {
    ...ifRev(),
    type: "image",
    fields: { image: user.image.imageId, alt: "A tiny picture" },
  });
  rev = imageBlock.rev;
  expect(imageBlock.block.image).toEqual({ imageId: user.image.imageId, width: 1, height: 1 });
  const updated = await call<any>("update_block", {
    ...ifRev(),
    blockId: link.blockId,
    fields: { label: "My renamed link" },
  });
  rev = updated.rev;
  const moved = await call<any>("move_block", {
    ...ifRev(),
    blockId: faq.blockId,
    position: "first",
  });
  rev = moved.rev;
  expect(moved.order[0].id).toBe(faq.blockId);
  const themed = await call<any>("set_theme", { ...ifRev(), theme: "Ivory" });
  rev = themed.rev;
  expect(themed.theme).toMatchObject({ kind: "system", name: "Ivory" });

  // A private preview link shows the saved draft, including text that exists only in the draft.
  const preview = await call<{ url: string }>("create_preview_link", { pageId: user.pageId });
  const previewHtml = await (await fetch(preview.url)).text();
  expect(previewHtml).toContain("A paragraph written by an assistant.");
  expect(previewHtml).toContain(CANARY);
  expect(await tenantHtml(user.handle)).not.toContain("A paragraph written by an assistant.");

  // Analytics: first nothing recorded, then the screen's own numbers.
  const empty = await call<any>("get_analytics", { pageId: user.pageId });
  expect(empty).toMatchObject({ recorded: false, kpis: null, topLinks: [] });
  const today = new Date().toISOString();
  const event = (type: "view" | "click", visitor: string, over: Record<string, unknown> = {}) => ({
    page_id: user.pageId,
    ts: today,
    type,
    block_id: type === "click" ? "Bt5rJ1fGz6Os" : "",
    visitor_hash: visitor,
    referrer: "instagram.com",
    device: "mobile",
    country: "US",
    ...over,
  });
  await admin.from("events").insert([event("view", "a"), event("view", "b"), event("click", "a")]);
  const numbers = await call<any>("get_analytics", { pageId: user.pageId, range: "30d" });
  const screen = await context.request.get(url("app", "/analytics/stats?range=30"));
  const stats = (await screen.json()) as {
    ok: boolean;
    data: {
      kpis: Record<string, unknown>;
      links: Array<{ label: string; clicks: number; ctr: string }>;
    };
  };
  expect(numbers.kpis).toEqual(stats.data.kpis);
  expect(numbers.topLinks).toEqual(
    stats.data.links.map((entry) => ({ label: entry.label, clicks: entry.clicks, ctr: entry.ctr })),
  );
  expect(numbers.kpis).toMatchObject({ views: 2, clicks: 1 });

  // Domains: a verified one is listed.
  await admin.from("domains").insert({
    page_id: user.pageId,
    hostname: `${user.handle}.example.test`,
    status: "verified",
    verified_at: today,
  });
  const domains = await call<any>("get_domains");
  expect(domains.domains).toEqual([
    expect.objectContaining({
      hostname: `${user.handle}.example.test`,
      status: "verified",
      pageId: user.pageId,
    }),
  ]);
  expect(domains.limits.customDomains).toEqual({ used: 1, max: 1 });

  const removed = await call<any>("remove_block", { ...ifRev(), blockId: imageBlock.blockId });
  rev = removed.rev;
  expect(removed.removedType).toBe("image");

  // A second page of the site (M12-05): create it, fill it, link to it from Home, set its settings. All
  // of it is draft, so the live site shows none of it until the one publish below takes the whole site.
  const SUB_CANARY = `SUBCANARY-${rand(8)}`;
  const created = await call<any>("create_page", {
    pageId: user.pageId,
    title: "Specials",
    path: "specials",
  });
  expect(created).toMatchObject({ title: "Specials", path: "/specials", inMenu: true });
  rev = created.homeRev;
  let subRev: number = created.rev;
  const sub = { pageId: user.pageId, subPageId: created.subPageId };
  const items = await call<any>("add_block", {
    ...sub,
    ifRev: subRev,
    type: "items",
    fields: {
      heading: "This week",
      layout: "grid",
      items: [
        { name: `Lamp ${SUB_CANARY}`, price: "$5", description: "Works fine" },
        { name: "Chair", price: "Free", image: user.image.imageId, sold: true },
      ],
    },
  });
  subRev = items.rev;
  expect(items.block.items[1].image).toEqual({ imageId: user.image.imageId, width: 1, height: 1 });
  const hours = await call<any>("add_block", {
    ...sub,
    ifRev: subRev,
    type: "hours",
    fields: {
      timezone: "America/Chicago",
      days: {
        mon: { ranges: [{ open: "09:00", close: "17:00" }] },
        tue: { ranges: [{ open: "09:00", close: "17:00" }] },
        wed: { ranges: [{ open: "09:00", close: "17:00" }] },
        thu: { ranges: [{ open: "09:00", close: "17:00" }] },
        fri: { ranges: [{ open: "09:00", close: "17:00" }] },
        sat: { closed: true },
        sun: { closed: true },
      },
    },
  });
  subRev = hours.rev;
  const moved2 = await call<any>("move_block", {
    ...sub,
    ifRev: subRev,
    blockId: hours.blockId,
    position: "first",
  });
  subRev = moved2.rev;
  expect(moved2.order.map((item: { type: string }) => item.type)).toEqual(["hours", "items"]);
  const settings = await call<any>("update_page_settings", {
    ...sub,
    ifRev: subRev,
    description: `Deals ${SUB_CANARY}`,
  });
  subRev = settings.rev;
  const linkToPage = await call<any>("add_block", {
    ...ifRev(),
    type: "page_link",
    fields: { label: "See the specials", target: created.subPageId },
  });
  rev = linkToPage.rev;
  expect(linkToPage.block).toMatchObject({ type: "page_link", target: created.subPageId });
  const readSub = await call<any>("get_page", sub);
  expect(readSub.page).toMatchObject({
    subPageId: created.subPageId,
    title: "Specials",
    path: "/specials",
    inMenu: true,
    live: false,
    rev: subRev,
  });
  expect(readSub.blocks.map((block: { type: string }) => block.type)).toEqual(["hours", "items"]);
  expect(readSub.publishIssues).toEqual([]);
  const withPages = await call<any>("list_pages");
  expect(withPages.pages[0].pages).toEqual([
    { id: "home", title: "Home", path: "/", inMenu: true, live: true },
    { id: created.subPageId, title: "Specials", path: "/specials", inMenu: true, live: false },
  ]);
  // Not live yet: neither the page nor the link to it.
  expect((await fetch(`http://${user.handle}.localhost:3000/specials`)).status).toBe(404);
  expect(await tenantHtml(user.handle)).not.toContain("See the specials");

  // Publish: the old content is live until the call, the new content is live on the very next request.
  const before = await tenantHtml(user.handle);
  expect(before).not.toContain("A paragraph written by an assistant.");
  const published = await call<any>("publish_page", { pageId: user.pageId });
  expect(published).toMatchObject({ published: true, url: `http://${user.handle}.localhost:3000` });
  const after = await tenantHtml(user.handle);
  // The whole site went live: the new page, and the link from Home to it.
  const specials = await tenantHtml(user.handle, "specials");
  expect(specials).toContain(`Lamp ${SUB_CANARY}`);
  expect(specials).toContain("This week");
  expect(after).toContain("See the specials");
  const liveList = await call<any>("list_pages");
  expect(liveList.pages[0].pages[1]).toMatchObject({ id: created.subPageId, live: true });
  expect(after).toContain("A paragraph written by an assistant.");
  expect(after).toContain(CANARY);
  expect(after).toContain("Is this live?");

  // The editor shows it all after a reload, and the chip says published.
  await openEditor(page);
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
  await expect(page.getByText("My renamed link").first()).toBeVisible();
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue(`New bio ${CANARY}`);

  // One activity row per tool call, in order, all ok, with no canary text anywhere in them.
  const rows = (await admin.from("mcp_activity").select("*").eq("user_id", user.userId).order("id"))
    .data!;
  expect(rows.map((item) => item.tool)).toEqual(calls);
  expect(rows.every((item) => item.ok === true && item.error_code === null)).toBe(true);
  expect(
    rows.every((item) => item.client_id === env.clientId && item.grant_id === env.grantId),
  ).toBe(true);
  expect(JSON.stringify(rows)).not.toContain(CANARY);
  expect(JSON.stringify(rows)).not.toContain(SUB_CANARY);
  expect(rows.filter((item) => item.page_id === user.pageId).length).toBeGreaterThan(8);

  const summary = [
    `MCP flow transcript: ${calls.length} tool calls, ${rows.length} activity rows (all ok, no content)`,
    ...transcript.map((line, index) => `${String(index + 1).padStart(2, "0")} ${line}`),
  ].join("\n");
  console.log(summary);
  await test.info().attach("mcp-flow-transcript", { body: summary, contentType: "text/plain" });
}
