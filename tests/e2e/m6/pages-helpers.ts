import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import { createPreviewLinkCore, type PreviewDeps } from "@/lib/previews/core";
import { adminClient } from "../fixtures/auth";
import { DEV_PORT } from "../helpers";
import { appRaw, type RawResponse } from "../fixtures/http";

/**
 * Shared setup for the Wave F page-name and preview-link specs (M6-09 .. M6-14). Links are made with
 * the real core against the real table (secret key, no limiter), so a spec can hold a link without
 * driving the dialog, and a replayed action can be compared with it.
 */

export const APP_ORIGIN = "http://app.localhost:3000";
export const INACTIVE = "This preview link isn’t active. Ask the owner for a new link.";

const octet = () => Math.floor(Math.random() * 254) + 1;
/** A client IP of this test's own (the share route and the create limit both count per client). */
export const randomIp = (): string => `10.${octet()}.${octet()}.${octet()}`;

export function previewDeps(over: Partial<PreviewDeps> = {}): PreviewDeps {
  return {
    admin: adminClient() as never,
    isSuspended: async () => false,
    limit: async () => ({ allowed: true, retryAfter: 0 }),
    appOrigin: APP_ORIGIN,
    ...over,
  };
}

export interface MadeLink {
  id: string;
  /** The full address, as the dialog shows it. */
  url: string;
  token: string;
  expiresAt: string;
}

export async function makeLink(userId: string, pageId: string): Promise<MadeLink> {
  const result = await createPreviewLinkCore(previewDeps(), userId, pageId);
  if (!result.ok) throw new Error(`makeLink failed: ${result.reason}`);
  return {
    id: result.id,
    url: result.url,
    token: result.url.slice(result.url.lastIndexOf("/") + 1),
    expiresAt: result.expiresAt,
  };
}

export async function revokeLink(id: string): Promise<void> {
  const { error } = await adminClient()
    .from("preview_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`revokeLink failed: ${error.message}`);
}

/** Moves a link's whole lifetime into the past (the table's check wants expires_at after created_at). */
export async function expireLink(id: string): Promise<void> {
  const day = 24 * 3600 * 1000;
  // A 6 day span: well inside the check (at most 7 days between created_at and expires_at).
  const now = Date.now();
  const { error } = await adminClient()
    .from("preview_links")
    .update({
      created_at: new Date(now - 9 * day).toISOString(),
      expires_at: new Date(now - 3 * day).toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`expireLink failed: ${error.message}`);
}

export async function linkRows(pageId: string) {
  const { data, error } = await adminClient()
    .from("preview_links")
    .select("*")
    .eq("page_id", pageId);
  if (error) throw new Error(`linkRows failed: ${error.message}`);
  return data ?? [];
}

export const sharePath = (token: string, rest = ""): string => `/share/${token}${rest}`;

/** GET /share/{token} on the app host from `ip`, redirects not followed. */
export const getShare = (
  token: string,
  ip: string,
  opts: { rest?: string; cookie?: string; method?: string } = {},
): Promise<RawResponse> =>
  appRaw(sharePath(token, opts.rest ?? ""), {
    method: opts.method ?? "GET",
    cookie: opts.cookie,
    headers: { "x-forwarded-for": ip },
  });

/** The visible words of an HTML body, scripts and styles gone (a rough innerText). */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<template[\s\S]*?<\/template>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The markup of an HTML answer without what differs on every request. Two answers that are the same
 * page are equal after this. What is taken out: the address the visitor asked for (a token, a path),
 * Next's per-request id (`self.__next_r`), the per-request CSP nonce on every script, and everything from the first Flight script on. The Flight
 * stream of `next dev` carries React's debug rows, whose order follows the timing of the render (a
 * lookup that takes longer streams its rows in a different order); the markup before it, which is
 * what a visitor and a crawler get, is what is compared.
 */
export function withoutRequestSpecifics(html: string, ...requested: string[]): string {
  let body = html;
  for (const value of requested) body = body.split(value).join("REQUESTED");
  const flight = body.indexOf("self.__next_f");
  if (flight !== -1) body = body.slice(0, flight);
  return body
    .replace(/self\.__next_r="[^"]*"/g, 'self.__next_r="ID"')
    .replace(/\bnonce="[^"]*"/g, 'nonce="NONCE"')
    .replace(/\/share\/[^"\\\s<]*/g, "/share/REQUESTED");
}

/** The same bucket the server builds for `rateLimit(key, ...)`: HMAC-SHA256 under the visitor-hash secret. */
export function rateLimitBucketOf(key: string): string {
  let secret = process.env.VISITOR_HASH_SECRET;
  if (!secret) {
    try {
      const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
      const match = /^\s*VISITOR_HASH_SECRET\s*=\s*(.*?)\s*$/m.exec(text);
      if (match) secret = match[1]!.replace(/^(['"])(.*)\1$/, "$2");
    } catch {
      // no env file: the local stand-in applies
    }
  }
  secret ||= "hydlnk-local-development-visitor-hash-secret";
  return createHmac("sha256", secret).update(`rate-limit\n${key}`).digest("hex");
}

/** Counts one hit of `key` in the real limiter (the `rate_limit_hit` function, secret key). */
export async function hitLimiter(key: string, limit: number, windowSeconds: number, times = 1) {
  const bucket = rateLimitBucketOf(key);
  for (let i = 0; i < times; i++) {
    const { error } = await adminClient().rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error(`rate_limit_hit failed: ${error.message}`);
  }
}

/** The result object of a Server Action response (a Flight stream: lines like `1:{"ok":false,...}`). */
export function actionResult(text: string): Record<string, unknown> | null {
  for (const line of text.split("\n")) {
    const match = /^\d+:(\{.*\})$/.exec(line);
    if (!match) continue;
    try {
      const value = JSON.parse(match[1]!) as Record<string, unknown>;
      if (typeof value.ok === "boolean") return value;
    } catch {
      // not JSON
    }
  }
  return null;
}

export interface CapturedAction {
  id: string;
  url: string;
}

/**
 * Runs `trigger` (a click that makes the page call a Server Action) and returns the id of the first
 * action it posted whose arguments satisfy `match`, with the URL it was posted to.
 */
export async function captureAction(
  page: Page,
  trigger: () => Promise<void>,
  match: (args: unknown) => boolean = () => true,
): Promise<CapturedAction> {
  const seen = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    const id = request.headers()["next-action"];
    if (!id) return false;
    try {
      return match(JSON.parse(request.postData() ?? "null"));
    } catch {
      return false;
    }
  });
  await trigger();
  const request = await seen;
  return { id: request.headers()["next-action"]!, url: request.url() };
}

/** Replays a captured Server Action from inside the page (its cookies, its origin) with other arguments. */
export async function replayAction(
  page: Page,
  action: CapturedAction,
  args: unknown[],
): Promise<{ status: number; result: Record<string, unknown> | null }> {
  const response = await page.evaluate(
    async ({ url, id, body }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Next-Action": id,
          Accept: "text/x-component",
          "Content-Type": "text/plain;charset=UTF-8",
        },
        body,
      });
      return { status: res.status, text: await res.text() };
    },
    { url: action.url, id: action.id, body: JSON.stringify(args) },
  );
  return { status: response.status, result: actionResult(response.text) };
}

/** The raw bytes of a response from the dev server for `host` (an image, say), redirects not followed. */
export function rawBytes(host: string, path: string): Promise<{ status: number; bytes: Buffer }> {
  return new Promise((resolveBytes, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: DEV_PORT,
        path,
        headers: { Host: host.replace(/:3000$/, `:${DEV_PORT}`) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolveBytes({ status: res.statusCode ?? 0, bytes: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
