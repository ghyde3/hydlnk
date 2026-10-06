/**
 * What may leave the app in a Sentry event (M9-10). Pure: no Sentry import, no environment read, no
 * network, so a test can feed it any event and read what comes out.
 *
 * `scrubEvent` returns a scrubbed deep copy of an event. It walks every string in it (the message,
 * every exception value, the variables of stack frames, tags, extras, contexts, breadcrumbs, spans,
 * the transaction name, the request URL) with `scrubString`, so a field nobody listed is covered
 * too, then removes what must never be sent at all (the user, request cookies, headers, bodies and
 * query strings, the server name).
 *
 *   an email address                              [email]
 *   a handle host   mara.hydlnk.com               [handle].hydlnk.com   (the configured root domain)
 *   /t/{handle}  /sites/{id}  /share/{token}      /t/[handle]  /sites/[id]  /share/[token]
 *   token= code= access_token= refresh_token= key= (and their JSON and header forms), sb- cookies,
 *   a JWT-shaped string (three base64url parts)   [Filtered]
 *   code_verifier= client_secret= client_assertion= csrf= hl_oauth_resume= and the three OAuth token
 *   shapes (hl_at_, hl_rt_, hl_ac_ plus 43 characters)   [Filtered]   (Wave L, M10-17)
 *
 * It is idempotent: scrubbing a scrubbed event changes nothing.
 */

export const FILTERED = "[Filtered]";
export const EMAIL_PLACEHOLDER = "[email]";

export interface ScrubOptions {
  /** NEXT_PUBLIC_ROOT_DOMAIN ("hydlnk.com", "localhost:3000"): what a handle host is a subdomain of. */
  rootDomain?: string | undefined;
}

/** The names whose values are secrets, in a query string, a JSON body or an object key. */
const SECRET_NAMES = [
  "access_token",
  "refresh_token",
  "token_hash",
  "id_token",
  "api_key",
  "apikey",
  "token",
  "code",
  "key",
  "password",
  "secret",
  // Wave L (M10-17): the OAuth authorization server's secrets.
  "code_verifier",
  "client_secret",
  "client_assertion",
  "csrf",
  // The cookie that carries a pending authorization request across a sign-in (M10-12).
  "hl_oauth_resume",
] as const;

/** Object keys whose value is dropped to [Filtered] whatever it is. */
const SECRET_KEYS = new Set<string>([
  ...SECRET_NAMES,
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

const NAMES = [...SECRET_NAMES].sort((a, b) => b.length - a.length).join("|");

const JWT = /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g;
/** The three secret shapes of the authorization server (M10-15): access, refresh and authorization code. */
const OAUTH_TOKEN = /hl_(?:at|rt|ac)_[A-Za-z0-9_-]{43}/g;
const BASE64_COOKIE_VALUE = /\bbase64-[A-Za-z0-9_-]{16,}/g;
// A value that is already [Filtered] is left alone, so scrubbing twice changes nothing.
const SB_PAIR = /\b(sb-[\w.-]+)=(?!\[Filtered\])([^;\s"'&,)}]+)/g;
const SECRET_PARAM = new RegExp(`(?<![A-Za-z0-9])(${NAMES})=(?!\\[Filtered\\])([^&\\s"'<>#;,)}]+)`, "gi");
const SECRET_JSON = new RegExp(`("(?:${NAMES})"\\s*:\\s*)"[^"]*"`, "gi");
const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const TENANT_PATH = /\/t\/[^/\s?#"'&)[\]]+/g;
const SITE_PATH = /\/sites\/[^/\s?#"'&)[\]]+/g;
const SHARE_PATH = /\/share\/[^/\s?#"'&)[\]]+/g;
const HOME_DIR = /(\/(?:Users|home)\/)[^/\s]+/g;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The regular expression that finds `{handle}.{root}`, or null when there is no root domain to go by. */
function handleHost(rootDomain: string | undefined): RegExp | null {
  const root = rootDomain?.trim().toLowerCase();
  if (!root) return null;
  // The label before the root, but never `app.` or `www.`: those are our own hosts, not a tenant's.
  return new RegExp(
    `(?<![A-Za-z0-9-])(?!(?:app|www)\\.)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.${escapeRegExp(root)}(?![A-Za-z0-9-])`,
    "gi",
  );
}

/** A string longer than this is cut (and says so) before it is scrubbed: a bound on what the patterns can cost. */
const MAX_STRING = 8_000;

/** One string, with everything personal replaced. */
export function scrubString(value: string, options: ScrubOptions = {}): string {
  let out = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}[Truncated]` : value;
  out = out.replace(JWT, FILTERED);
  out = out.replace(OAUTH_TOKEN, FILTERED);
  out = out.replace(BASE64_COOKIE_VALUE, FILTERED);
  out = out.replace(SB_PAIR, (_match, name: string) => `${name}=${FILTERED}`);
  out = out.replace(SECRET_PARAM, (_match, name: string) => `${name}=${FILTERED}`);
  out = out.replace(SECRET_JSON, (_match, prefix: string) => `${prefix}"${FILTERED}"`);
  out = out.replace(EMAIL, EMAIL_PLACEHOLDER);
  const host = handleHost(options.rootDomain);
  if (host) {
    const root = options.rootDomain!.trim().toLowerCase();
    out = out.replace(host, `[handle].${root}`);
  }
  out = out.replace(TENANT_PATH, "/t/[handle]");
  out = out.replace(SITE_PATH, "/sites/[id]");
  out = out.replace(SHARE_PATH, "/share/[token]");
  out = out.replace(HOME_DIR, (_match, dir: string) => `${dir}[user]`);
  return out;
}

/** An address or a path without its query string and fragment. */
export function stripQuery(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** Every `http(s)://...?query` inside a text loses its query string and fragment. */
export function stripQueryInText(value: string): string {
  return value.replace(/(https?:\/\/[^\s"'<>?#]*)[?#][^\s"'<>]*/g, (_match, address: string) => address);
}

/** Keys whose string value is an address or a path: they keep no query string and no fragment. */
const URL_KEYS = new Set([
  "url",
  "url.full",
  "http.url",
  "http.target",
  "href",
  "from",
  "to",
  "request_path",
  "pathname",
  "transaction",
]);

/** Keys that hold a query string on its own: dropped outright. */
const QUERY_KEYS = new Set(["query_string", "url.query", "http.query", "query", "search", "hash"]);

const MAX_DEPTH = 40;
/** The most nodes one scrub will walk: a bound on the cost whatever the SDK hands over. */
const MAX_NODES = 20_000;

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A plain object (or one with no prototype): JSON-like data, as opposed to a class instance such as a Scope. */
function isPlainObject(value: unknown): value is Dict {
  if (!isDict(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

interface Walk {
  options: ScrubOptions;
  /** The objects on the way down to the current one: a cycle is cut, never followed. */
  path: Set<object>;
  nodes: number;
}

function scrubValue(value: unknown, key: string | undefined, walk: Walk, depth: number): unknown {
  const lower = key?.toLowerCase();
  if (lower !== undefined && (SECRET_KEYS.has(lower) || lower.startsWith("sb-"))) {
    // A secret's value is never kept, whatever it holds. (Absent stays absent.)
    return value === null || value === undefined ? value : FILTERED;
  }
  if (typeof value === "string") {
    let out = scrubString(value, walk.options);
    if (lower !== undefined && URL_KEYS.has(lower)) out = stripQuery(out);
    return out;
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth > MAX_DEPTH || ++walk.nodes > MAX_NODES) return "[Truncated]";
  if (walk.path.has(value)) return "[Circular]";
  if (value instanceof Error) {
    // Only what an error is called and says; the message is scrubbed like any other string.
    return { name: value.name, message: scrubString(value.message, walk.options) };
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    // A class instance (a Date, a Map, an SDK scope): not data, and not for us to copy.
    return `[${(value as object).constructor?.name ?? "Object"}]`;
  }
  walk.path.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => scrubValue(item, undefined, walk, depth + 1));
  } else {
    const copy: Dict = {};
    for (const [name, inner] of Object.entries(value)) {
      if (QUERY_KEYS.has(name.toLowerCase())) continue;
      copy[name] = scrubValue(inner, name, walk, depth + 1);
    }
    out = copy;
  }
  walk.path.delete(value);
  return out;
}

const newWalk = (options: ScrubOptions): Walk => ({ options, path: new Set(), nodes: 0 });

/** A breadcrumb or any other JSON-like value, scrubbed the same way an event is. */
export function scrubJson<T>(value: T, options: ScrubOptions = {}): T {
  return scrubValue(value, undefined, newWalk(options), 0) as T;
}

/**
 * The scrubbed copy of an event (an error, a message or a transaction). Fields that are never sent:
 * the user, the server name, and the request's cookies, headers, body and query string. The request
 * URL stays, without its query string and fragment.
 */
export function scrubEvent<E extends object>(event: E, options: ScrubOptions = {}): E {
  // `sdkProcessingMetadata` is the SDK's own working data (it holds live scopes and the request it is
  // reading); the SDK removes it before anything is sent, and reads it after this hook, so it is
  // neither walked nor copied: it goes back in untouched.
  const { sdkProcessingMetadata, ...rest } = event as E & { sdkProcessingMetadata?: unknown };
  const out = scrubValue(rest, undefined, newWalk(options), 0) as Dict;
  if (sdkProcessingMetadata !== undefined) out.sdkProcessingMetadata = sdkProcessingMetadata;
  delete out.user;
  delete out.server_name;
  const request = out.request;
  if (isDict(request)) {
    for (const field of ["cookies", "headers", "data", "query_string", "env"]) delete request[field];
    if (typeof request.url === "string") request.url = stripQuery(request.url);
  }
  const spans = out.spans;
  if (Array.isArray(spans)) {
    for (const span of spans) {
      // A span named for an outgoing request ("GET https://x.supabase.co/rest/v1/pages?handle=eq.mara").
      if (isDict(span) && typeof span.description === "string") {
        span.description = stripQueryInText(span.description);
      }
    }
  }
  return out as E;
}
