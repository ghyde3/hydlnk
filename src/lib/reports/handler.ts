import { clientIpOf } from "./client-ip";
import { REPORT_LIMITS, REPORT_MESSAGES } from "./constants";
import { submitReport, type ReportDeps } from "./submit";

/**
 * The HTTP side of POST /report/submit (M5-05): body reading with a size cap, the same-site check,
 * and turning a ReportOutcome into a Response. Takes the dependencies as an argument so a test can
 * drive it with a plain Request.
 *
 * The body is JSON (what the form sends) or a classic form post (urlencoded or multipart), so the
 * endpoint also answers a script that posts a form. Every answer is JSON and carries
 * `cache-control: no-store`.
 */

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

/** Reads at most `limit` bytes of the body; null when it is longer. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
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

/** `{page, reason, ...}` as plain strings, from JSON or form data; null when the body is neither. */
function parseBody(text: string, contentType: string): Record<string, unknown> | null {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type === "application/json") {
    try {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (type === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return null;
}

/**
 * A browser form on another site must not be able to file reports with a visitor's IP: when an
 * Origin header is sent it has to be this very host. A request with no Origin (curl, a server)
 * passes: the per-reporter limit is what bounds those.
 */
function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function handleReportRequest(request: Request, deps: ReportDeps): Promise<Response> {
  if (!sameSite(request)) {
    return json(403, { ok: false, message: "This form can only be sent from hydlnk.com." });
  }
  const text = await readCapped(request, REPORT_LIMITS.bodyBytes);
  if (text === null) return json(413, { ok: false, message: "That report is too large." });

  const body = parseBody(text, request.headers.get("content-type") ?? "");
  if (!body) return json(400, { ok: false, message: "Send the report as JSON or a form." });

  try {
    const outcome = await submitReport(body, clientIpOf(request.headers), deps);
    return json(outcome.status, outcome.body, outcome.headers);
  } catch (error) {
    console.error("[report] submission failed", error instanceof Error ? error.message : error);
    return json(500, { ok: false, message: REPORT_MESSAGES.server });
  }
}
