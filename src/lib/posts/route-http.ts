import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { readEntrySaveBody } from "@/lib/site-pages/entry-save-core";

/**
 * What every Posts route does before its core (M16-12): the session, the Origin and, for a route
 * that takes a body, JSON of a bounded size. One helper, so no route can forget a step. Every answer
 * is `no-store`.
 *
 *   401  {kind: "unauthorized"}   no session; nothing is read or written
 *   403  {error: "forbidden_origin"}   a request from another origin (the session cookie is host-only
 *        and SameSite, and this is the second lock)
 *   415  {error: "expected_json"}   400 {error: "invalid_body"}   413 {kind: "too-large"}
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The bodies of these routes are a rev, a title, a name: anything larger is refused before it is read. */
const MAX_BODY_BYTES = 4 * 1024;

export function answer(out: { status: number; body: unknown }): NextResponse {
  return NextResponse.json(out.body, { status: out.status, headers: NO_STORE });
}

export function failed(label: string, error: unknown): NextResponse {
  console.error(`[posts] ${label} failed`, error);
  return NextResponse.json({ kind: "error" }, { status: 500, headers: NO_STORE });
}

type Gate =
  | { ok: true; userId: string; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

/** `body: "json"` for a route that reads one (POST, PATCH); `"none"` for GET and DELETE. */
export async function gate(request: Request, body: "json" | "none"): Promise<Gate> {
  const refuse = (payload: unknown, status: number): Gate => ({
    ok: false,
    response: NextResponse.json(payload, { status, headers: NO_STORE }),
  });
  const user = await getSessionUser();
  if (!user) return refuse({ kind: "unauthorized" }, 401);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) {
    return refuse({ error: "forbidden_origin" }, 403);
  }
  if (body === "none") return { ok: true, userId: user.id, body: {} };
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return refuse({ error: "expected_json" }, 415);
  const read = await readEntrySaveBody(request, MAX_BODY_BYTES);
  if (!read.ok && read.reason === "too_large") return refuse({ kind: "too-large" }, 413);
  if (!read.ok || !read.value || typeof read.value !== "object" || Array.isArray(read.value)) {
    return refuse({ error: "invalid_body" }, 400);
  }
  return { ok: true, userId: user.id, body: read.value as Record<string, unknown> };
}
