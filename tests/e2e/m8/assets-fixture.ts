import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page, Request } from "@playwright/test";
import { EMBEDS, FIXTURE_PAGE_ID, type FixtureEmbed } from "./assets-embeds";

export { EMBEDS, FIXTURE_PAGE_ID, type FixtureEmbed };

/**
 * Fixture pages for the M8 asset specs: the real tenant script, the real inline CSS and the real
 * facade markup on a page the test serves itself (`page.route`), so the script and the CSS can be
 * checked in Chrome on every host, before and after the live HTML builder exists. Nothing here
 * reads a database or publishes a page.
 */

const rendered = new Map<string, string>();

/** The page's HTML, rendered by tests/e2e/m8/assets-render.ts (React runs there, not in Playwright). */
export function embedsPageHtml(
  embeds: readonly FixtureEmbed[],
  options: { pageId?: string; script?: boolean; extraBody?: string } = {},
): string {
  const key = JSON.stringify({ names: embeds.map((embed) => embed.name), ...options });
  let html = rendered.get(key);
  if (html === undefined) {
    html = JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", join(process.cwd(), "tests/e2e/m8/assets-render.ts"), key],
        { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      ),
    ) as string;
    rendered.set(key, html);
  }
  return html;
}

export interface Watched {
  /** Every request the page made, in order: method, host, path. */
  requests: { method: string; host: string; path: string; type: string }[];
  /** `POST /api/e` bodies, with the content type the browser sent. */
  beacons: { host: string; body: string; contentType: string }[];
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Serves `html` at `url` and makes the rest of the world unreachable: the script and anything else
 * on the page's own host go to the dev server (or, for a host that does not exist, to the file),
 * `/api/e` is answered 204 and recorded, and every other host is aborted and recorded.
 */
export async function serveFixture(
  context: BrowserContext | Page,
  url: string,
  html: string,
): Promise<Watched> {
  const watched: Watched = { requests: [], beacons: [], consoleErrors: [], pageErrors: [] };
  const target = new URL(url);
  await context.route("**/*", async (route) => {
    const request: Request = route.request();
    const u = new URL(request.url());
    watched.requests.push({
      method: request.method(),
      host: u.host,
      path: u.pathname,
      type: request.resourceType(),
    });
    if (u.host !== target.host) {
      await route.abort();
      return;
    }
    if (u.pathname === target.pathname && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
      return;
    }
    if (u.pathname === "/api/e" && request.method() === "POST") {
      watched.beacons.push({
        host: u.host,
        body: request.postData() ?? "",
        contentType: (await request.allHeaders())["content-type"] ?? "",
      });
      await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
      return;
    }
    if (/^\/_t\/p\.[0-9a-f]{12}\.js$/.test(u.pathname)) {
      // The built file from disk, whatever the host: a custom host in a fixture has no server behind it.
      await route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: readFileSync(join(process.cwd(), "public", u.pathname), "utf8"),
      });
      return;
    }
    await route.continue();
  });
  return watched;
}

/** Watches a page's console and uncaught errors. */
export function watchErrors(page: Page, watched: Watched): void {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      watched.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => watched.pageErrors.push(String(error)));
}
