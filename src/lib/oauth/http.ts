/**
 * HTTP helpers shared by the OAuth endpoints (M10-02, M10-15, M10-17): headers, CORS, JSON answers,
 * a request body read with a cap, and a form parsed with the rules of RFC 6749 (a parameter at most
 * once). No imports from the app, so a Vitest drives them directly.
 *
 * These endpoints use bearer credentials and PKCE, never cookies: no response of this wave ever
 * carries `Access-Control-Allow-Credentials` (a scan of src/ keeps it that way), and `*` is the right
 * `Access-Control-Allow-Origin` for them (browser-based MCP clients, ChatGPT's connector flow).
 */

/** The first line of every HTML screen the authorization server answers. */
export const HTML_DOCTYPE = "<!doctype html>";

/** Headers of every answer that carries or may carry a secret. */
export const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export const CORS_PREFLIGHT_MAX_AGE = "86400";

/** CORS for the three POST endpoints: token, registration, revocation. */
export function postCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": CORS_PREFLIGHT_MAX_AGE,
  };
}

/** CORS for the two metadata documents. */
export function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": CORS_PREFLIGHT_MAX_AGE,
  };
}

/** A preflight answer: 204, no body, the CORS headers, and no database read behind it. */
export function preflightResponse(cors: Record<string, string>): Response {
  return new Response(null, {
    status: 204,
    headers: { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** `405 Method Not Allowed` with the `Allow` header of the route. */
export function methodNotAllowed(allow: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: allow,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** The OAuth error object of RFC 6749 section 5.2: `{ error, error_description }`. */
export function oauthErrorResponse(
  status: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(status, { error, error_description: description }, headers);
}

export type BodyRead =
  { ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" };

/**
 * Reads a request body as text, at most `maxBytes`. A `Content-Length` over the cap is refused before
 * a byte is read, and a stream that passes the cap is cancelled the moment the count does (never
 * buffered whole). A body with no declared length is counted as it arrives.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return { ok: false, reason: "unreadable" };
    if (length > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** The media type of a request, lower case, without parameters (`; charset=utf-8`). */
export function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

export type FormParse =
  | { ok: true; values: Map<string, string> }
  | { ok: false; reason: "repeated" | "malformed"; name?: string };

/**
 * An `application/x-www-form-urlencoded` body as name -> value. A parameter that appears twice is
 * refused (RFC 6749 section 3.2: "Parameters sent without a value MUST be treated as if they were
 * omitted from the request ... Request and response parameters MUST NOT be included more than once").
 * An empty value counts as omitted.
 */
export function parseForm(text: string): FormParse {
  const values = new Map<string, string>();
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  for (const [name, value] of params) {
    if (values.has(name)) return { ok: false, reason: "repeated", name };
    if (value !== "") values.set(name, value);
    else values.set(name, "");
  }
  // Empty values read as absent.
  for (const [name, value] of [...values]) if (value === "") values.delete(name);
  return { ok: true, values };
}
