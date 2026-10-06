import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page } from "@playwright/test";
import { publishedDocSchema, type Block, type PublishDoc } from "@/lib/document";
import { insertPage, makeUser, rand } from "../fixtures/data";
import { rawRequest, type RawResponse } from "../fixtures/http";
import { DEV_PORT, url } from "../helpers";
import { publishDocOf } from "../m2/blocks-helpers";
import {
  DESKTOP_UA,
  eventsOf,
  randomIp,
  type IngestPage,
  type RawOptions,
} from "../m4/analytics-ingest-helpers";

export {
  DESKTOP_UA,
  IPHONE_UA,
  getClick,
  randomIp,
  waitForClicks,
  settledCount,
} from "../m4/analytics-ingest-helpers";

/**
 * Shared setup for the link specs of Wave K: UTM tags (M9-27, M9-28), the link lock (M9-29, M9-30)
 * and redirect mode (M9-31, M9-32). A page that is live with a published document of our choosing
 * (the secret key writes it, so these specs do not depend on the Publish action; write it before the
 * first request, a tenant page is cached after its first render), raw requests that name the Host and
 * the client IP exactly, and a stub destination server that records what a browser asks of it, so
 * "a tap lands on a destination whose query holds the tags" is something the test can read.
 */

export const OWNER_EMAIL_PREFIX = "zq-";

// A stub destination ---------------------------------------------------------------------------

export interface Stub {
  /** `stub-xxxxxx.localhost`: a host Chromium resolves to loopback and the blocklist accepts (it has a dot). */
  host: string;
  port: number;
  /** Every request but the favicon's, in order: path and query exactly as received. */
  hits: { url: string; referer: string | undefined }[];
  /** `http://<host>:<port><path>` */
  url(path?: string): string;
  close(): Promise<void>;
}

export async function startStub(): Promise<Stub> {
  const hits: Stub["hits"] = [];
  const server = http.createServer((req, res) => {
    if (req.url !== "/favicon.ico") hits.push({ url: req.url ?? "", referer: req.headers.referer });
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><title>Stub destination</title><p id="stub-destination">Stub destination</p>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const host = `stub-${rand(6)}.localhost`;
  return {
    host,
    port,
    hits,
    url: (path = "/") => `http://${host}:${port}${path}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// A live page ----------------------------------------------------------------------------------

export interface LinkPage extends IngestPage {
  /** The id of every block the helper was given, by position. */
  ids: string[];
}

export interface PageExtras {
  utm?: Record<string, string>;
  redirect?: { linkId: string };
}

/** The published document of `blocks` with the page-level extras, parsed by the strict schema. */
export function docOf(blocks: Block[], extras: PageExtras = {}): PublishDoc {
  return publishedDocSchema.parse({ ...publishDocOf(blocks), ...extras });
}

export const link = (id: string, url: string, extra: Record<string, unknown> = {}): Block =>
  ({ id, type: "link", visible: true, label: `Link ${id}`, url, ...extra }) as Block;

/** A fresh user with one page that is live with `doc`. The page keeps no draft of its own. */
export async function livePage(
  label: string,
  doc: PublishDoc,
  opts: { plan?: "free" | "pro" | "studio"; suspended?: boolean; published?: boolean } = {},
): Promise<LinkPage> {
  const user = await makeUser(label, { plan: opts.plan, suspended: opts.suspended });
  const handle = `zq-${label}-${rand(5)}`;
  const extra: Record<string, unknown> = {};
  if (opts.published !== false) {
    extra.published = doc;
    extra.published_at = new Date().toISOString();
  }
  const pageId = await insertPage(user.id, handle, extra);
  return {
    userId: user.id,
    email: user.email,
    handle,
    pageId,
    host: `${handle}.localhost:${DEV_PORT}`,
    origin: `http://${handle}.localhost:${DEV_PORT}`,
    url: url(handle),
    doc,
    ids: doc.blocks.map((block) => block.id),
  };
}

// Raw requests ---------------------------------------------------------------------------------

/** POST /r/<pageId>/<id> on the page's tenant host with a form body, the way the interstitial posts it. */
export function postClick(
  page: IngestPage,
  id: string,
  body: string | null,
  opts: RawOptions & { pageId?: string; contentType?: string | null } = {},
): Promise<RawResponse> {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip === null ? "" : (opts.ip ?? randomIp()),
    "user-agent": opts.ua === null ? "" : (opts.ua ?? DESKTOP_UA),
    origin: opts.origin === null ? "" : (opts.origin ?? page.origin),
    "sec-fetch-site": "same-origin",
    ...opts.headers,
  };
  if (opts.contentType !== null)
    headers["content-type"] = opts.contentType ?? "application/x-www-form-urlencoded";
  for (const [name, value] of Object.entries(headers)) if (value === "") delete headers[name];
  return rawRequest(opts.host ?? page.host, `/r/${opts.pageId ?? page.pageId}/${id}`, {
    method: "POST",
    headers,
    ...(body === null ? {} : { body }),
  });
}

/** GET (or HEAD) of the tenant page itself on a host, redirects not followed. */
export function getPage(
  host: string,
  opts: { method?: string; path?: string; ua?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  return rawRequest(host, opts.path ?? "/", {
    method: opts.method ?? "GET",
    headers: {
      "user-agent": opts.ua ?? DESKTOP_UA,
      "x-forwarded-for": randomIp(),
      ...opts.headers,
    },
  });
}

/** Asserts a response holds nothing of a destination: not in its headers, not in its body. */
export function expectNoDestination(response: RawResponse, ...needles: string[]): void {
  const text = `${JSON.stringify(response.headers)}\n${response.body}`;
  for (const needle of needles) expect(text, `the response holds ${needle}`).not.toContain(needle);
}

/** Clicks a locked or plain link of the live page and returns once the browser has left it. */
export async function openLive(page: Page, live: Pick<LinkPage, "url">): Promise<void> {
  await page.goto(live.url);
  await expect(page.locator("[data-page-root]")).toBeVisible();
}

/** Gives a late `after()` insert time to land, then returns how many CLICK rows the page has (page views do not count). */
export async function settledClicks(pageId: string, ms = 700): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return (await eventsOf(pageId)).filter((row) => row.type === "click").length;
}
