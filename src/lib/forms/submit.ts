import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import { isBot } from "@/lib/analytics/ingest/bot";
import { notice, readBodyUpTo, recordClick } from "@/lib/analytics/ingest/click-common";
import { hostServesPage } from "@/lib/analytics/ingest/host";
import { isCrossSitePost } from "@/lib/analytics/ingest/lock-gate";
import type { EventRow, FormTarget } from "@/lib/analytics/ingest/types";
import type { VisitorHashInput } from "@/lib/analytics/ingest/hash";
import { PLAN_LIMITS, type PlanId } from "@/lib/limits";
import type { RateLimitResult } from "@/lib/rate-limit";
import { setTenantHeaders } from "@/lib/routing/tenant-headers";
import {
  FORM_FIELD,
  FORM_KIND_LABELS,
  SUBMISSION_LIMITS,
  formActionPath,
  isBlockId,
  isUuid,
  linksIn,
  parseSubmission,
  refusedField,
  SUBMISSION_MESSAGES,
  type FormRenderState,
  type RecordStatus,
  type SubmissionValues,
} from "./contract";
import type { MessageNotice } from "./notify";
import { markOpened, openedSecondsAgo } from "./open-marker";
import type { SubmissionRecord } from "./store";
import { issueFormToken, readFormToken } from "./token";

/**
 * The form routes (Wave D, M17-05, M17-06). Plain HTML on both sides: the block posts here, and every
 * answer is a page or a same-origin 303. The order of a POST is fixed, cheapest first, nothing stored
 * before the last step, and every "dropped" case answers exactly like a success:
 *
 *    1  cross-site POST    Origin / Sec-Fetch-Site (as the link lock)           403 notice, first
 *    2  ids                pageId a UUID, blockId 8-24 of [A-Za-z0-9_-]        404 notice, no query
 *    3  limit              10 POSTs per client in 10 minutes                    429 + Retry-After
 *    4  body               x-www-form-urlencoded, at most 32,768 bytes          415, 413 notice
 *    5  block              a visible form in the PUBLISHED documents            404; 503 on a db error
 *    6  host               the real Host header serves the site                 404 notice
 *    7  bot user agent     dropped                                              303 to the sent page
 *    8  honeypot           dropped                                              303 to the sent page
 *    9  fields             parseSubmission                                      422 error page
 *   10  fill time          the open marker >= 3 s (read only: only GET /o      200 confirm page
 *                          starts it), or a valid token 2 s to 1 h
 *   11  token once         form-token:{signature}, 1 an hour                    200 confirm page
 *   12  blocked link       a contact message linking a blocked host: dropped    303; 503 if unknown
 *   13  limits             3 per client and form in 10 min; per site an hour a  429 + Retry-After
 *                          quarter of the plan's daily cap (5 / 125 / 1,250)
 *   14  store              record_form_submission: stored, duplicate and over   303; 404 if the site
 *                          a cap answer 303; a field a check refused, 422       went away; 503 on a
 *                                                                               db error
 *   15  after the answer   the click row, the owner's message or limit email
 *
 * Every response of the form routes, whatever its status, goes through `formResponse`: the tenant
 * page policy, `no-store`, `noindex`, no framing (M17-05 step 3).
 *
 * Nothing a visitor typed, and no IP address or user agent, is ever logged: a failure logs a constant
 * message, the error's class and its code (`logReason`), never the error's message. The 303's Location is built from the two validated ids, never from
 * the request. The limiter fails open; the monthly cap in the database is the hard bound.
 */

export const FORM_POST_LIMIT = 10;
export const FORM_POST_WINDOW_SECONDS = 600;
export const FORM_BLOCK_LIMIT = 3;
export const FORM_BLOCK_WINDOW_SECONDS = 600;
/**
 * Accepted submissions per site an hour: a quarter of the plan's daily cap per site (the hard bound
 * in the database), so a burst of junk needs four hours to take a day and the 429 a person may see
 * comes from the same numbers as the caps (security review A1).
 */
export const FORM_SITE_HOURLY_SHARE = 4;
export const FORM_SITE_WINDOW_SECONDS = 3600;
export function formSiteHourlyLimit(plan: PlanId): number {
  return Math.ceil(PLAN_LIMITS[plan].formSubmissionsPerSiteDay / FORM_SITE_HOURLY_SHARE);
}
export const FORM_GET_LIMIT = 120;
export const FORM_GET_WINDOW_SECONDS = 60;
export const MIN_FILL_SECONDS = 3;
export const TOKEN_MIN_AGE_MS = 2000;
export const TOKEN_MAX_AGE_MS = 3_600_000;

export const FORM_NOTICES = {
  notFound: "This form isn’t available.",
  crossSite: "This request didn’t come from this page.",
  tooMany: "That’s a lot of sending. Wait a moment and try again.",
  tooLarge: "That was too much to send. Shorten your message and try again.",
  wrongType: "This form can’t take that kind of request.",
  unavailable: "This form can’t take a message right now. Try again in a moment.",
  method: "This address can’t take that kind of request.",
} as const;

/** Everything the handlers touch outside the request; the routes pass the real ones (`./deps`). */
export interface FormDeps {
  rateLimit: (key: string, limit: number, windowSeconds: number) => Promise<RateLimitResult>;
  /** Reads a limiter bucket without counting (`rateLimitAge`): the open marker's read. */
  rateLimitAge: (key: string, windowSeconds: number) => Promise<number | null>;
  now: () => Date;
  /** For the click row only (`recordClick`); a submission stores no hash. */
  visitorHash: (input: VisitorHashInput) => string;
  /** The token's HMAC key (the visitor-hash secret). */
  tokenSecret: () => string;
  /** `now`: the server clock, for the block's time window (M20-05). */
  resolveFormBlock: (pageId: string, blockId: string, now: number) => Promise<FormTarget | null>;
  /** The handle and verified hosts of a published site, for the open marker's host check. */
  lookupSite: (pageId: string) => Promise<Pick<FormTarget, "handle" | "customHosts"> | null>;
  renderFormPage: (input: {
    pageId: string;
    target: FormTarget;
    state: FormRenderState;
  }) => Promise<string | null>;
  hasBlockedLink: (links: readonly string[]) => Promise<boolean>;
  recordSubmission: (
    row: SubmissionRecord,
  ) => Promise<{ status: RecordStatus; ownerId: string | null }>;
  insertEvent: (row: EventRow) => Promise<void>;
  notifyOwnerOfMessage: (input: MessageNotice) => Promise<unknown>;
  notifyOwnerOfLimit: (input: { ownerId: string }) => Promise<unknown>;
  schedule: (task: () => Promise<void>) => void;
  rootDomain: string;
  /** The marketing home, for the notice pages' link. */
  homeHref: string;
}

export interface FormParams {
  pageId: string;
  blockId: string;
}

/**
 * What a failure logs: the error's class and, when it carries one, its short code (a SQLSTATE such
 * as 23514, FormStoreError's code), never its message, which a dependency may have built from the
 * row it failed on (the visitor's address).
 */
function logReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)
    ? `${error.name} (${code})`
    : error.name;
}

/** The transparent 1x1 GIF of the open marker: 43 bytes. */
const PIXEL = Uint8Array.from(
  Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"),
);

const ALLOW_FORM = "GET, HEAD, POST";
const ALLOW_MARKER = "GET, HEAD";

function retryNotice(deps: FormDeps, limit: RateLimitResult, head = false): Response {
  return notice(429, FORM_NOTICES.tooMany, deps.homeHref, head, {
    "Retry-After": String(Math.max(1, limit.retryAfter)),
  });
}

/** The one answer of a stored, duplicate, over-limit or dropped submission. */
function sentRedirect(pageId: string, blockId: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: formActionPath(pageId, blockId), "Cache-Control": "no-store" },
  });
}

/**
 * The headers of EVERY form route response (M17-05 step 3), whatever built it: the themed pages, the
 * HYDLNK notices of 403 to 503 (`notice`, shared with `/r` and `/c`, whose own headers stay as they
 * are), the 303 and the marker image. The tenant page policy (`TENANT_PAGE_CSP`, nosniff, no
 * framing), never cached, never indexed. A response that chose its Referrer-Policy keeps it (a
 * notice's `no-referrer`, a themed page's `same-origin`). Nothing here sets a cookie.
 */
function formResponse(response: Response): Response {
  const referrer = response.headers.get("Referrer-Policy");
  setTenantHeaders(response.headers);
  if (referrer) response.headers.set("Referrer-Policy", referrer);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

/** A themed form page (the headers come from `formResponse`): no cookie, no script. */
function pageResponse(status: number, html: string | null, head: boolean): Response {
  return new Response(head ? null : html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Same origin keeps the confirm page's POST carrying a real Origin header.
      "Referrer-Policy": "same-origin",
    },
  });
}

/** Steps 5 and 6, shared by every route: the block from the published documents, on its own host. */
async function openForm(
  request: Request,
  params: FormParams,
  deps: FormDeps,
  head: boolean,
): Promise<Response | { pageId: string; target: FormTarget }> {
  const pageId = params.pageId.toLowerCase();
  let target: FormTarget | null;
  try {
    target = await deps.resolveFormBlock(pageId, params.blockId, deps.now().getTime());
  } catch (error) {
    console.error("[forms] loading the form failed:", logReason(error));
    return notice(503, FORM_NOTICES.unavailable, deps.homeHref, head);
  }
  if (target === null || !hostServesPage(request.headers.get("host"), target, deps.rootDomain)) {
    return notice(404, FORM_NOTICES.notFound, deps.homeHref, head);
  }
  return { pageId, target };
}

function validIds(params: FormParams): boolean {
  return isUuid(params.pageId) && isBlockId(params.blockId);
}

/** True for `application/x-www-form-urlencoded`, with or without a charset. */
function isFormEncoded(request: Request): boolean {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return type === "application/x-www-form-urlencoded";
}

async function renderState(
  deps: FormDeps,
  pageId: string,
  target: FormTarget,
  state: FormRenderState,
  status: number,
  head = false,
): Promise<Response> {
  const html = await deps.renderFormPage({ pageId, target, state });
  if (html === null) return notice(404, FORM_NOTICES.notFound, deps.homeHref, head);
  return pageResponse(status, html, head);
}

/** GET and HEAD /f/{pageId}/{blockId}: the "sent" page (also where every stored POST lands). */
export async function handleFormSent(
  request: Request,
  params: FormParams,
  deps: FormDeps,
): Promise<Response> {
  return formResponse(await formSent(request, params, deps));
}

async function formSent(request: Request, params: FormParams, deps: FormDeps): Promise<Response> {
  const head = request.method === "HEAD";
  if (!validIds(params)) return notice(404, FORM_NOTICES.notFound, deps.homeHref, head);
  const client = rateLimitClientKey(request.headers);
  const limit = await deps.rateLimit(`form-get:${client}`, FORM_GET_LIMIT, FORM_GET_WINDOW_SECONDS);
  if (!limit.allowed) return retryNotice(deps, limit, head);
  const opened = await openForm(request, params, deps, head);
  if (opened instanceof Response) return opened;
  const { pageId, target } = opened;
  return renderState(deps, pageId, target, { blockId: target.block.id, view: "sent" }, 200, head);
}

/** GET and HEAD /f/{pageId}/o: the open marker. A 43-byte image; nothing else is read or written. */
export async function handleFormOpen(
  request: Request,
  params: { pageId: string },
  deps: FormDeps,
): Promise<Response> {
  return formResponse(await formOpen(request, params, deps));
}

async function formOpen(
  request: Request,
  params: { pageId: string },
  deps: FormDeps,
): Promise<Response> {
  const head = request.method === "HEAD";
  if (!isUuid(params.pageId)) return notice(404, FORM_NOTICES.notFound, deps.homeHref, head);
  const client = rateLimitClientKey(request.headers);
  const limit = await deps.rateLimit(`form-get:${client}`, FORM_GET_LIMIT, FORM_GET_WINDOW_SECONDS);
  if (!limit.allowed) return retryNotice(deps, limit, head);
  const pageId = params.pageId.toLowerCase();
  let site: Pick<FormTarget, "handle" | "customHosts"> | null;
  try {
    site = await deps.lookupSite(pageId);
  } catch (error) {
    console.error("[forms] loading the site for the open marker failed:", logReason(error));
    return notice(503, FORM_NOTICES.unavailable, deps.homeHref, head);
  }
  if (site === null || !hostServesPage(request.headers.get("host"), site, deps.rootDomain)) {
    return notice(404, FORM_NOTICES.notFound, deps.homeHref, head);
  }
  if (!head) await markOpened(deps.rateLimit, client, pageId);
  return new Response(head ? null : PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.byteLength),
    },
  });
}

/** Any other method of a form route: 405 with `Allow`. */
export function formMethodNotAllowed(marker: boolean): Response {
  return formResponse(
    notice(405, FORM_NOTICES.method, "/", false, { Allow: marker ? ALLOW_MARKER : ALLOW_FORM }),
  );
}

/** POST /f/{pageId}/{blockId}: a submission. */
export async function handleFormPost(
  request: Request,
  params: FormParams,
  deps: FormDeps,
): Promise<Response> {
  return formResponse(await formPost(request, params, deps));
}

async function formPost(request: Request, params: FormParams, deps: FormDeps): Promise<Response> {
  const { homeHref } = deps;
  // 1. cross-site, before anything else (M17-06 step 3), 2. ids, 3. the client's POSTs.
  if (isCrossSitePost(request)) return notice(403, FORM_NOTICES.crossSite, homeHref, false);
  if (!validIds(params)) return notice(404, FORM_NOTICES.notFound, homeHref, false);
  const client = rateLimitClientKey(request.headers);
  const posts = await deps.rateLimit(
    `form-post:${client}`,
    FORM_POST_LIMIT,
    FORM_POST_WINDOW_SECONDS,
  );
  if (!posts.allowed) return retryNotice(deps, posts);

  // 4. the body.
  if (!isFormEncoded(request)) return notice(415, FORM_NOTICES.wrongType, homeHref, false);
  const text = await readBodyUpTo(request, SUBMISSION_LIMITS.bodyBytes);
  if (text === "too-large") return notice(413, FORM_NOTICES.tooLarge, homeHref, false);
  const fields = new URLSearchParams(text);

  // 5. the block and 6. the host.
  const opened = await openForm(request, params, deps, false);
  if (opened instanceof Response) return opened;
  const { pageId, target } = opened;
  const { block } = target;
  const done = () => sentRedirect(pageId, block.id);

  // 7. bots and 8. the honeypot: answered like a success, nothing stored.
  const userAgent = request.headers.get("user-agent");
  if (isBot(userAgent)) return done();
  if ((fields.get(FORM_FIELD.honeypot) ?? "") !== "") return done();

  // 9. the fields.
  const now = deps.now();
  const binding = { pageId, blockId: block.id, client, now, secret: deps.tokenSecret() };
  const parsed = parseSubmission(block.kind, block.askName === true, {
    email: fields.get(FORM_FIELD.email),
    name: fields.get(FORM_FIELD.name),
    message: fields.get(FORM_FIELD.message),
  });
  const again = (view: "confirm" | "error", values: SubmissionValues, status: number, extra = {}) =>
    renderState(
      deps,
      pageId,
      target,
      { blockId: block.id, view, values, token: issueFormToken(binding), ...extra },
      status,
    );
  if (!parsed.ok) return again("error", parsed.values, 422, { errors: parsed.errors });
  const { values } = parsed;

  // 10. the fill time, and 11. a token works once.
  const token = fields.get(FORM_FIELD.token) ?? "";
  if (token !== "") {
    const read = readFormToken(token, binding);
    if (!read.ok || read.ageMs < TOKEN_MIN_AGE_MS || read.ageMs > TOKEN_MAX_AGE_MS) {
      return again("confirm", values, 200);
    }
    const spent = await deps.rateLimit(`form-token:${read.signature}`, 1, 3600);
    if (!spent.allowed) return again("confirm", values, 200);
  } else {
    const age = await openedSecondsAgo(deps.rateLimitAge, client, pageId);
    if (age === null || age < MIN_FILL_SECONDS) return again("confirm", values, 200);
  }

  // 12. a link to a blocked host in a message: answered like a success, nothing stored.
  if (block.kind === "contact") {
    let blocked: boolean;
    try {
      blocked = await deps.hasBlockedLink(linksIn(values.message));
    } catch (error) {
      console.error("[forms] checking the links of a message failed:", logReason(error));
      return notice(503, FORM_NOTICES.unavailable, homeHref, false);
    }
    if (blocked) return done();
  }

  // 13. accepted submissions per client and form, and per site.
  const perForm = await deps.rateLimit(
    `form-block:${client}:${pageId}:${block.id}`,
    FORM_BLOCK_LIMIT,
    FORM_BLOCK_WINDOW_SECONDS,
  );
  if (!perForm.allowed) return retryNotice(deps, perForm);
  const perSite = await deps.rateLimit(
    `form-site:${pageId}`,
    formSiteHourlyLimit(target.plan),
    FORM_SITE_WINDOW_SECONDS,
  );
  if (!perSite.allowed) return retryNotice(deps, perSite);

  // 14. store.
  let result: { status: RecordStatus; ownerId: string | null };
  try {
    result = await deps.recordSubmission({
      siteId: pageId,
      blockId: block.id,
      entryId: target.subPageId ?? null,
      kind: block.kind,
      email: values.email,
      name: values.name,
      message: values.message,
    });
  } catch (error) {
    console.error("[forms] storing a submission failed:", logReason(error));
    return notice(503, FORM_NOTICES.unavailable, homeHref, false);
  }

  // 15. after the answer. A site unpublished or suspended since step 5 is gone, not "sent"; a value
  // a check of the table refused (never expected: the app strips what the checks refuse) is that
  // field's error, never a 503 that loses the message.
  const { status, ownerId } = result;
  if (status === "unavailable") return notice(404, FORM_NOTICES.notFound, homeHref, false);
  const refused = refusedField(status);
  if (refused !== null) {
    return again("error", values, 422, { errors: { [refused]: SUBMISSION_MESSAGES.unsupported } });
  }
  if (status === "stored") {
    recordClick(request, pageId, block.id, deps, target.subPageId);
    if (block.kind === "contact" && block.notify === true && ownerId) {
      const message: MessageNotice = {
        ownerId,
        handle: target.handle,
        formTitle: block.heading || FORM_KIND_LABELS[block.kind],
        ...values,
      };
      deps.schedule(async () => {
        await deps.notifyOwnerOfMessage(message);
      });
    }
  } else if (status === "over_limit_first" && ownerId) {
    deps.schedule(async () => {
      await deps.notifyOwnerOfLimit({ ownerId });
    });
  }
  return done();
}
