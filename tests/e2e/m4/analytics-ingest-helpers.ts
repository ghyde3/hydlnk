import { devices, test as base } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { insertPage, makeUser, rand } from "../fixtures/data";
import { rawRequest, type RawResponse } from "../fixtures/http";
import { DEV_PORT, url } from "../helpers";
import { publishDocOf } from "../m2/blocks-helpers";
import type { Block, PublishDoc } from "@/lib/document";

/**
 * Shared setup for the analytics-collection specs (M4-20 .. M4-23, M5-01, M5-02): a page published
 * with the secret key (one block of each linkable kind with a fixed id), raw requests that name a
 * Host and a client IP exactly (no browser adds or follows anything), and event reads with the
 * secret key. Every test makes its own user and page and picks its own random client IP, so the two
 * projects and parallel workers never share a rate-limit bucket or an events row.
 */

/** A real iPhone 13 user agent (the phone project) and a real desktop Chrome one (the desktop project). */
export const IPHONE_UA = devices["iPhone 13"].userAgent;
export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** What Playwright's headless Chromium sends by default: the one a bot filter must drop. */
export const HEADLESS_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36";

/** The projects (scripts/lib/viewports.ts) already send a real Chrome user agent, so `test` is Playwright's own. */
export const test = base;
export { expect } from "@playwright/test";

export const userAgentFor = (projectName: string): string =>
  projectName === "phone" ? IPHONE_UA : DESKTOP_UA;

const num = (max: number) => Math.floor(Math.random() * max);

/** A random IPv4 client address from the benchmarking range (RFC 2544), one bucket of its own. */
export const randomIp = (): string => `198.${18 + num(2)}.${num(256)}.${1 + num(254)}`;

/** A random IPv6 client address; the rate limiter's bucket is its /64, which this changes too. */
export const randomIpv6 = (): string =>
  `2001:db8:${num(0x10000).toString(16)}:${num(0x10000).toString(16)}::${(1 + num(0xfffe)).toString(16)}`;

// ---------------------------------------------------------------------------------------------
// A published page with every kind of link
// ---------------------------------------------------------------------------------------------

export const IDS = {
  link: "lnkbook0001",
  card: "cardstudio01",
  header: "hdrbook0001",
  text: "txtabout0001",
  divider: "divider00001",
  social: "socialrow001",
  iconWeb: "icoinsta0001",
  iconMail: "icomail00001",
  grid: "gridprints01",
  cellA: "cellprint001",
  cellB: "cellwork0001",
  draftOnly: "draftonly001",
} as const;

export const TARGETS: Record<string, string> = {
  [IDS.link]: "https://example.com/book",
  [IDS.card]: "https://example.com/studio",
  [IDS.iconWeb]: "https://example.com/instagram",
  [IDS.cellA]: "https://example.com/prints",
  [IDS.cellB]: "https://example.com/workshops",
};

export function linkBlocks(): Block[] {
  return [
    { id: IDS.header, type: "header", visible: true, text: "Book a session" },
    { id: IDS.link, type: "link", visible: true, label: "Book", url: TARGETS[IDS.link]! },
    {
      id: IDS.card,
      type: "card",
      visible: true,
      title: "Studio",
      caption: "See the studio",
      url: TARGETS[IDS.card]!,
      image: null,
    },
    {
      id: IDS.social,
      type: "social",
      visible: true,
      icons: [
        { id: IDS.iconWeb, platform: "instagram", url: TARGETS[IDS.iconWeb]! },
        { id: IDS.iconMail, platform: "email", address: "hello@example.com" },
      ],
    },
    {
      id: IDS.grid,
      type: "grid",
      visible: true,
      cells: [
        { id: IDS.cellA, title: "Prints", subtitle: "Shop", url: TARGETS[IDS.cellA]! },
        { id: IDS.cellB, title: "Workshops", subtitle: "Small groups", url: TARGETS[IDS.cellB]! },
      ],
    },
    { id: IDS.text, type: "text", visible: true, text: "About me" },
    { id: IDS.divider, type: "divider", visible: true },
  ];
}

export interface IngestPage {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
  /** `<handle>.localhost:3000`: the Host header of the page. */
  host: string;
  /** `http://<handle>.localhost:3000`: the page's own Origin. */
  origin: string;
  /** `http://<handle>.localhost:3000/` */
  url: string;
  doc: PublishDoc;
}

/**
 * A fresh user with one page, published with `linkBlocks()` unless told otherwise. Write the
 * document before the first request: a tenant page is cached after its first render.
 */
export async function ingestPage(
  label: string,
  opts: { published?: boolean; plan?: "free" | "pro" | "studio"; blocks?: Block[]; draft?: unknown } = {},
): Promise<IngestPage> {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  const doc = publishDocOf(opts.blocks ?? linkBlocks());
  const extra: Record<string, unknown> = {};
  if (opts.published !== false) {
    extra.published = doc;
    extra.published_at = new Date().toISOString();
  }
  if (opts.draft !== undefined) extra.draft = opts.draft;
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
  };
}

// ---------------------------------------------------------------------------------------------
// Events, read with the secret key
// ---------------------------------------------------------------------------------------------

export interface EventRow {
  id: number;
  page_id: string;
  block_id: string;
  type: "view" | "click";
  ts: string;
  referrer: string | null;
  device: string | null;
  country: string | null;
  visitor_hash: string;
}

export async function eventsOf(pageId: string): Promise<EventRow[]> {
  const { data, error } = await adminClient()
    .from("events")
    .select("*")
    .eq("page_id", pageId)
    .order("id");
  if (error) throw new Error(`events read failed: ${error.message}`);
  return data as EventRow[];
}

export const countEvents = async (pageId: string): Promise<number> => (await eventsOf(pageId)).length;

/** Waits (the click insert runs after the response) until the page has at least `n` events. */
export async function waitForEvents(pageId: string, n: number, timeout = 15_000): Promise<EventRow[]> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const rows = await eventsOf(pageId);
    if (rows.length >= n) return rows;
    if (Date.now() > deadline) throw new Error(`expected ${n} events for ${pageId}, found ${rows.length}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** Waits until the page has at least `n` CLICK rows (views from page loads do not count) and returns them. */
export async function waitForClicks(pageId: string, n: number, timeout = 15_000): Promise<EventRow[]> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const clicks = (await eventsOf(pageId)).filter((row) => row.type === "click");
    if (clicks.length >= n) return clicks;
    if (Date.now() > deadline) throw new Error(`expected ${n} clicks for ${pageId}, found ${clicks.length}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** Gives a late `after()` insert time to land, then returns the count: for "nothing was recorded". */
export async function settledCount(pageId: string, ms = 700): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return countEvents(pageId);
}

// ---------------------------------------------------------------------------------------------
// Raw requests (the Host, the client IP, the Origin and the user agent exactly as given)
// ---------------------------------------------------------------------------------------------

export interface RawOptions {
  /** The client IP the platform would report (x-forwarded-for). Default: a fresh random one. Null: none. */
  ip?: string | null;
  ua?: string | null;
  /** Default: the page's own origin. Null: no Origin header. */
  origin?: string | null;
  method?: string;
  headers?: Record<string, string>;
  /** The Host header. Default: the page's tenant host. */
  host?: string;
}

function rawHeaders(page: Pick<IngestPage, "origin">, opts: RawOptions, withOrigin: boolean) {
  const headers: Record<string, string> = {};
  const ip = opts.ip === undefined ? randomIp() : opts.ip;
  if (ip) headers["x-forwarded-for"] = ip;
  if (opts.ua !== null) headers["user-agent"] = opts.ua ?? DESKTOP_UA;
  const origin = opts.origin === undefined ? page.origin : opts.origin;
  if (withOrigin && origin) headers.origin = origin;
  return { ...headers, ...opts.headers };
}

/** POST /api/e on the page's tenant host with `body` (an object is JSON-encoded). */
export function postBeacon(
  page: IngestPage,
  body: unknown = { pageId: page.pageId, referrer: "" },
  opts: RawOptions = {},
): Promise<RawResponse> {
  const method = opts.method ?? "POST";
  const hasBody = method !== "GET" && method !== "HEAD";
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return rawRequest(opts.host ?? page.host, "/api/e", {
    method,
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      ...rawHeaders(page, opts, true),
    },
    ...(hasBody ? { body: payload } : {}),
  });
}

/** GET (or HEAD) /r/<pageId>/<id> on the page's tenant host, redirects not followed. */
export function getClick(
  page: IngestPage,
  id: string,
  opts: RawOptions & { pageId?: string; query?: string } = {},
): Promise<RawResponse> {
  return rawRequest(opts.host ?? page.host, `/r/${opts.pageId ?? page.pageId}/${id}${opts.query ?? ""}`, {
    method: opts.method ?? "GET",
    headers: rawHeaders(page, opts, false),
  });
}
