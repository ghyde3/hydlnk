import type { BrowserContext, Page } from "@playwright/test";
import { SERVER_PORT } from "../m2/publish-helpers";

/**
 * Network recording for the M8 specs: one CDP session with Network.enable per page, every request
 * with its on-the-wire size (`encodedDataLength`, response headers included), and the split of a
 * first visit into what counts against the page's own host (M8-09) and what does not (images on the
 * root /media origin, the favicon). No `page.route` here: interception turns the HTTP cache off, and
 * the reload checks need it on.
 */

const ROOT_ORIGIN = `http://localhost:${SERVER_PORT}`;

export interface Entry {
  id: string;
  url: string;
  method: string;
  type: string;
  mime: string;
  status: number;
  bytes: number;
  headers: Record<string, string>;
  /** Answered by the browser's own HTTP cache: not a request to the network. */
  fromCache: boolean;
}

export interface Visit {
  entries: Entry[];
  console: string[];
  pageErrors: string[];
  violations: string[];
}

/** Records every request of the page through one CDP session, with its on-the-wire size. */
export async function record(context: BrowserContext, page: Page) {
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  const byId = new Map<string, Entry>();
  let lastActivity = Date.now();
  client.on("Network.requestWillBeSent", (event) => {
    lastActivity = Date.now();
    byId.set(event.requestId, {
      id: event.requestId,
      url: event.request.url,
      method: event.request.method,
      type: event.type ?? "",
      mime: "",
      status: 0,
      bytes: 0,
      headers: {},
      fromCache: false,
    });
  });
  client.on("Network.responseReceived", (event) => {
    lastActivity = Date.now();
    const entry = byId.get(event.requestId);
    if (entry) {
      entry.mime = event.response.mimeType;
      entry.status = event.response.status;
      entry.headers = Object.fromEntries(
        Object.entries(event.response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
      );
    }
  });
  client.on("Network.requestServedFromCache", (event) => {
    const entry = byId.get(event.requestId);
    if (entry) entry.fromCache = true;
  });
  client.on("Network.loadingFinished", (event) => {
    lastActivity = Date.now();
    const entry = byId.get(event.requestId);
    if (entry) entry.bytes = event.encodedDataLength;
  });
  client.on("Network.loadingFailed", () => {
    lastActivity = Date.now();
  });
  const visit: Visit = { entries: [], console: [], pageErrors: [], violations: [] };
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      visit.console.push(message.text());
  });
  page.on("pageerror", (error) => visit.pageErrors.push(String(error)));
  return {
    visit,
    entries: () => [...byId.values()],
    /** Waits for `load`, then for 1 second without network activity. */
    async settle() {
      await page.waitForLoadState("load");
      const deadline = Date.now() + 20_000;
      while (Date.now() - lastActivity < 1000 && Date.now() < deadline) {
        await page.waitForTimeout(100);
      }
    },
  };
}

export function classify(entries: Entry[], own: string) {
  const own_ = entries.filter((entry) => new URL(entry.url).host === own);
  const isFavicon = (entry: Entry) =>
    /^\/(?:icon\.svg|favicon\.ico)$/.test(new URL(entry.url).pathname);
  const isRootMedia = (entry: Entry) => {
    const u = new URL(entry.url);
    return u.origin === ROOT_ORIGIN && u.pathname.startsWith("/media/");
  };
  const counted = own_.filter((entry) => !isFavicon(entry));
  const thirdParty = entries.filter((entry) => {
    const u = new URL(entry.url);
    if (u.protocol === "data:" || u.protocol === "blob:") return false;
    return u.host !== own && !isRootMedia(entry);
  });
  return {
    counted,
    documents: counted.filter((entry) => entry.type === "Document"),
    fonts: counted.filter((entry) => entry.mime === "font/woff2" || entry.type === "Font"),
    scripts: counted.filter((entry) => entry.type === "Script"),
    beacons: counted.filter(
      (entry) => entry.method === "POST" && new URL(entry.url).pathname === "/api/e",
    ),
    media: entries.filter(isRootMedia),
    thirdParty,
  };
}
