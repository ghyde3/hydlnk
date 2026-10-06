import { rateLimitClientKey } from "./client-ip";
import { notice, recordClick } from "./click-common";
import {
  LOCK_PAGE_HEADERS,
  LINK_BUSY_MESSAGE,
  LOCK_UNAVAILABLE_MESSAGE,
  MISSING_CODE_MESSAGE,
  MISSING_CONFIRM_MESSAGE,
  TOO_MANY_TRIES_MESSAGE,
  WRONG_CODE_MESSAGE,
  lockPageHtml,
  type LockPageKind,
} from "./lock-page";
import { locationFor } from "./target";
import type { ClickLock, ClickTarget, IngestDeps } from "./types";

/**
 * The gate of a locked link (M9-29): what `/r/<pageId>/<id>` answers for a link whose published
 * block carries a lock. Called by the click handler after it has checked the ids, the limiter, the
 * page and the host, so everything here may assume a real, published, served link.
 *
 *   GET and HEAD   200 and the interstitial (an age question, or a code field). Never a Location,
 *                  never the destination, never a click row. A `?code=` or `?confirm=1` is ignored.
 *   POST           the visitor's answer: `confirm=1` for an age lock, `code=...` for a code lock.
 *                  Right: 303 to the destination (with its UTM tags) and one click row. Wrong: 403
 *                  and the interstitial again. Nothing is remembered: no cookie, every visit asks.
 *
 * A code is accepted from the POST body only, so it never lands in a URL, a log or the history. The
 * attempts are limited through the one limiter, failing CLOSED (the only caller besides the code
 * hashing action that asks for it): a limiter that cannot count must not let anyone guess a code.
 *
 * Three limits, checked in this order and all before a single code is hashed:
 *   1  per client and link (5 a minute) and per client overall (20 in ten minutes);
 *   2  per link, ALL clients together (60 an hour): the heat of the link. Under it nothing changes;
 *   3  once the link is over it ("hot"), each client gets ONE try per ten minutes on that link.
 * Limits 1 and 2 stop one client; they do nothing against many, and a short code (a 4 digit PIN has
 * 10,000 values) falls to a few dozen addresses. Limit 3 is the backoff that grows with the guessing:
 * a sustained attack drops from 5 tries a minute per address to 1 in ten, while nobody is ever locked
 * out. There is no ceiling on the link: every client keeps a try of its own, so a stranger cannot
 * shut real visitors out, and a visitor who types the right code first time is never slowed.
 *
 * Known limits: the heat counts tries, not only wrong ones (a link that really is that busy goes hot,
 * where visitors still open it with a right first try); and the sliding window cannot pass an hour
 * (`rate_limit_hit` refuses more), so the heat and its backoff are measured inside that. A code that
 * is long enough is the real defence; the editor warns about a short number (`lockCodeWarning`).
 */

/** Code tries a client may make on one link per minute, and on all links per ten minutes. */
export const LOCK_LINK_LIMIT = 5;
export const LOCK_LINK_WINDOW_SECONDS = 60;
export const LOCK_CLIENT_LIMIT = 20;
export const LOCK_CLIENT_WINDOW_SECONDS = 600;
/** Code tries one link takes from every client together in an hour before it counts as hot. */
export const LOCK_LINK_WIDE_LIMIT = 60;
export const LOCK_LINK_WIDE_WINDOW_SECONDS = 3600;
/** On a hot link: one try per client per ten minutes. */
export const LOCK_HOT_CLIENT_LIMIT = 1;
export const LOCK_HOT_CLIENT_WINDOW_SECONDS = 600;

/** The most a POST body may hold, in bytes: a code is at most 32 characters. */
export const LOCK_BODY_MAX_BYTES = 1024;

const FORM_TYPE = "application/x-www-form-urlencoded";

function kindOf(lock: ClickLock): LockPageKind | null {
  return lock.kind === "age" || lock.kind === "code" ? lock.kind : null;
}

/** The interstitial as a response. HEAD gets the status and headers and no body. */
export function interstitial(
  kind: LockPageKind,
  action: string,
  head: boolean,
  options: { status?: number; error?: string; extra?: Record<string, string> } = {},
): Response {
  const status = options.status ?? 200;
  return new Response(
    head ? null : lockPageHtml({ kind, action, error: options.error ?? null, status }),
    {
      status,
      headers: { ...LOCK_PAGE_HEADERS, ...options.extra },
    },
  );
}

/** GET and HEAD of a locked link: the interstitial, or the 503 notice for a lock that is not valid. */
export function lockedGetResponse(
  params: { pageId: string; blockId: string },
  lock: ClickLock,
  head: boolean,
  homeHref: string,
): Response {
  const kind = kindOf(lock);
  // A stored lock that is not one of the two valid shapes is never read as "unlocked".
  if (kind === null) return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, head);
  return interstitial(kind, actionOf(params), head);
}

function actionOf(params: { pageId: string; blockId: string }): string {
  return `/r/${params.pageId.toLowerCase()}/${params.blockId}`;
}

/**
 * True for a POST that did not come from the page's own interstitial: an `Origin` that is present
 * and is not this request's own, or a `Sec-Fetch-Site` that says another site made it. An attacker's
 * page must not be able to make a visitor's browser guess codes.
 *
 * `Origin: null` is what a browser sends for a form post made by a page with `Referrer-Policy:
 * no-referrer` (the interstitial's own), so it passes only when `Sec-Fetch-Site` confirms the same
 * origin; anything else that says `null` is refused.
 */
export function isCrossSitePost(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site === "cross-site" || site === "same-site") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  if (origin.trim().toLowerCase() === "null") return site !== "same-origin";
  const host = request.headers.get("host")?.trim().toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() !== host;
  } catch {
    return true;
  }
}

/** The body as text, or `"too-large"` once it passes the cap: never reads more than the cap plus one chunk. */
async function readSmallBody(request: Request): Promise<string | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LOCK_BODY_MAX_BYTES) return "too-large";
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LOCK_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function pass(
  request: Request,
  params: { pageId: string; blockId: string },
  target: ClickTarget,
  deps: IngestDeps,
): Response {
  recordClick(request, params.pageId.toLowerCase(), params.blockId, deps, target.subPageId);
  // 303: the browser follows with a GET. No cookie and nothing cached: the next visit asks again.
  return new Response(null, {
    status: 303,
    headers: { Location: locationFor(target.url), "Cache-Control": "no-store" },
  });
}

/** The visitor's answer to the interstitial. `target.lock` is a valid age or code lock. */
export async function handleLockedPost(
  request: Request,
  params: { pageId: string; blockId: string },
  target: ClickTarget & { lock: ClickLock },
  deps: IngestDeps & { homeHref: string },
): Promise<Response> {
  const { homeHref } = deps;
  const lock = target.lock;
  const kind = kindOf(lock);
  if (kind === null) return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);
  const action = actionOf(params);

  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== FORM_TYPE) {
    return notice(415, "This form can’t be read.", homeHref, false);
  }
  const text = await readSmallBody(request);
  if (text === "too-large") return notice(413, "That request is too large.", homeHref, false);
  const form = new URLSearchParams(text);

  if (kind === "age") {
    if (form.get("confirm") !== "1") {
      return interstitial("age", action, false, { status: 400, error: MISSING_CONFIRM_MESSAGE });
    }
    return pass(request, params, target, deps);
  }

  // A code lock: a code is required, then the limiter, then (and only then) the check.
  const code = form.get("code");
  if (code === null || code.trim() === "") {
    return interstitial("code", action, false, { status: 400, error: MISSING_CODE_MESSAGE });
  }
  if (lock.kind !== "code") return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);

  const client = rateLimitClientKey(request.headers);
  const perLink = await deps.rateLimit(
    `lock:${client}:${params.pageId.toLowerCase()}:${params.blockId}`,
    LOCK_LINK_LIMIT,
    LOCK_LINK_WINDOW_SECONDS,
    { failClosed: true },
  );
  if (perLink.failed) return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);
  if (!perLink.allowed) return tooManyTries(action, perLink.retryAfter);
  const overall = await deps.rateLimit(
    `lock-all:${client}`,
    LOCK_CLIENT_LIMIT,
    LOCK_CLIENT_WINDOW_SECONDS,
    { failClosed: true },
  );
  if (overall.failed) return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);
  if (!overall.allowed) return tooManyTries(action, overall.retryAfter);

  // The link's heat, after the client limits so that a client already being refused cannot heat the
  // link for everyone. A refused call is not counted, so a flood does not extend the heat.
  const pageId = params.pageId.toLowerCase();
  const wide = await deps.rateLimit(
    `lock-link:${pageId}:${params.blockId}`,
    LOCK_LINK_WIDE_LIMIT,
    LOCK_LINK_WIDE_WINDOW_SECONDS,
    { failClosed: true },
  );
  if (wide.failed) return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);
  if (!wide.allowed) {
    // Hot: this client's one try per ten minutes on this link.
    const slow = await deps.rateLimit(
      `lock-slow:${client}:${pageId}:${params.blockId}`,
      LOCK_HOT_CLIENT_LIMIT,
      LOCK_HOT_CLIENT_WINDOW_SECONDS,
      { failClosed: true },
    );
    if (slow.failed) return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);
    if (!slow.allowed) return tooManyTries(action, slow.retryAfter, LINK_BUSY_MESSAGE);
  }

  if (!deps.verifyLock) return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);
  let ok = false;
  try {
    ok = await deps.verifyLock(code, { salt: lock.salt, hash: lock.hash });
  } catch {
    // Never the code in a log or a message: only that the check could not run.
    console.error("[lock] checking a code failed");
    return notice(503, LOCK_UNAVAILABLE_MESSAGE, homeHref, false);
  }
  if (!ok) return interstitial("code", action, false, { status: 403, error: WRONG_CODE_MESSAGE });
  return pass(request, params, target, deps);
}

function tooManyTries(
  action: string,
  retryAfter: number,
  message: string = TOO_MANY_TRIES_MESSAGE,
): Response {
  return interstitial("code", action, false, {
    status: 429,
    error: message,
    extra: { "Retry-After": String(Math.max(1, retryAfter)) },
  });
}
