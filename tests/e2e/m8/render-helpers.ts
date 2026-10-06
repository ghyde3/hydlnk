import { expect, type BrowserContext } from "@playwright/test";
import { emptyDraft, toPublishForm, type Block, type DraftDoc } from "@/lib/document";
import { adminClient } from "../fixtures/auth";
import { rand } from "../fixtures/data";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import { emptyUser, setDraft } from "../m2/editor-helpers";
import { SERVER_PORT, rawBuffer, type RawBufferResponse } from "../m2/publish-helpers";

/**
 * Shared setup of the live-page specs (Wave J, M8-02 .. M8-09). The server under test is the shared
 * dev server on :3000, or a production build when HL_PROD_PORT is set: the two answer the same
 * documents, only the production build caches them (x-nextjs-cache, the query counter).
 */

export { SERVER_PORT, rawBuffer };
export const PROD = Boolean(process.env.HL_PROD_PORT);

/** `http://{handle}.localhost:{port}{path}`: the page as a visitor's browser asks for it. */
export const tenantUrl = (handle: string, path = "/") =>
  `http://${handle}.localhost:${SERVER_PORT}${path}`;

/** GET with the Host header of a handle host, redirects not followed. */
export const getTenant = (handle: string, path = "/", headers: Record<string, string> = {}) =>
  rawBuffer(`${handle}.localhost:${SERVER_PORT}`, path, { headers });

/** GET with the Host header of a custom host. */
export const getCustom = (
  hostname: string,
  path = "/",
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
) => rawBuffer(`${hostname}:${SERVER_PORT}`, path, opts);

export const link = (id: string, label: string, url = "https://example.com/x"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url,
});

/** The published form of a draft, written the way Publish writes it. */
export async function publishDraft(pageId: string, draft: DraftDoc, publishedAt = new Date()) {
  const { error } = await adminClient()
    .from("pages")
    .update({ published: toPublishForm(draft, null), published_at: publishedAt.toISOString() })
    .eq("id", pageId);
  expect(error).toBeNull();
}

export interface LiveUser {
  id: string;
  email: string;
  handle: string;
  pageId: string;
  draft: DraftDoc;
}

/**
 * A user with a published page (a name, a bio and the given blocks) and a draft equal to it. The
 * page is never requested here, so its first GET is the first generation.
 */
export async function liveUser(
  context: BrowserContext,
  label: string,
  opts: {
    plan?: "free" | "pro" | "studio";
    blocks?: Block[];
    bio?: string;
    tokens?: Partial<DraftDoc["theme"]>;
  } = {},
): Promise<LiveUser> {
  const user = await emptyUser(context, label, opts.plan ? { plan: opts.plan } : {});
  const draft = emptyDraft(user.handle);
  draft.profile.name = `Zq ${label}`;
  draft.profile.bio = opts.bio ?? `Bio of ${label}`;
  draft.blocks = opts.blocks ?? [link(`lnk-${label}-0001`.slice(0, 20), "Book now")];
  await setDraft(user.pageId, draft);
  await publishDraft(user.pageId, draft);
  return { id: user.id, email: user.email, handle: user.handle, pageId: user.pageId, draft };
}

/** A verified custom hostname of a page (written with the secret key, like the server does). */
export async function customHostOf(pageId: string, label = "live"): Promise<string> {
  const hostname = hostnameFor(label);
  await addDomainRow({ pageId, hostname, status: "verified" });
  return hostname;
}

export async function queryCount(handle: string): Promise<number> {
  const res = await getTenant(handle, "/hl-query-count");
  expect(res.status, "the server must run with HYDLNK_QUERY_COUNTER=1").toBe(200);
  return (JSON.parse(res.text) as { count: number }).count;
}

/** How often the site index (the live sub-pages' paths) really read Postgres for this handle's site. */
export async function indexQueryCount(handle: string): Promise<number> {
  const res = await getTenant(handle, "/hl-query-count");
  expect(res.status, "the server must run with HYDLNK_QUERY_COUNTER=1").toBe(200);
  return (JSON.parse(res.text) as { indexCount: number }).indexCount;
}

/**
 * Arms a one-shot failure of the next database read for `handle` (only that handle: specs run side by
 * side), or disarms it; false when the server was not started with HYDLNK_QUERY_COUNTER=1.
 */
export async function armFailure(handle: string, armed = true): Promise<boolean> {
  const res = await getTenant(handle, armed ? "/hl-fail-next-read" : "/hl-fail-next-read?off=1");
  return res.status === 200;
}

export const cacheState = (res: Pick<RawBufferResponse, "headers">) =>
  String(res.headers["x-nextjs-cache"] ?? "");

/** Everything between `<body>` and the script: the renderer's markup. */
export const bodyOf = (html: string): string =>
  /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? `NO BODY: ${html.slice(0, 200)}`;

export const FRAMEWORK_MARKERS = [
  "__next_f",
  "__NEXT_DATA__",
  "/_next/",
  "$RC",
  "<template data-dgst",
  "modulepreload",
  "data-reactroot",
  "<!--$-->",
] as const;

export const rid = () => rand(6);
