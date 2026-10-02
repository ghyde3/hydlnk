import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { getPrincipal } from "./auth";
import { createAdminDeps } from "./deps";
import { executeAdminAction } from "./execute";
import { denyUnlessAdmin } from "./principal";
import type { AdminAction } from "./types";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const respond = (status: number, body: Record<string, unknown>): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE });

/**
 * The Route Handler of one admin mutation (`POST /api/admin/...` on the app host). Every file under
 * `src/app/(editor)/app/api/admin/` is `export const POST = adminRoute(<action>)` and nothing else;
 * tests/unit/admin-actions-guard.test.ts fails on any other shape.
 *
 *   403  forbidden_origin: a cross-origin Origin header (a cross-site form or fetch)
 *   401  nobody is signed in      403  signed in, not an admin
 *   415  not JSON                 400  not a valid request
 *   200  {changed, ...}           404 / 409 the action's own refusals     500  anything else
 *
 * Admin identity is the verified session (`getPrincipal`), never a request field. The id of the
 * thing acted on is the path segment; any `id` in the body is ignored. A refused caller learns
 * nothing about the target and the target is never read.
 */
export function adminRoute(action: AdminAction) {
  return async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) {
      return respond(403, { error: "forbidden_origin" });
    }

    const principal = await getPrincipal();
    const denied = denyUnlessAdmin(principal);
    if (denied) return respond(denied.status, { error: denied.error, message: denied.message });

    const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") return respond(415, { error: "expected_json" });
    try {
      const body: unknown = await request.json();
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return respond(400, { error: "invalid_body" });
      }
    } catch {
      return respond(400, { error: "invalid_body" });
    }

    const { id } = await context.params;
    const result = await executeAdminAction(action, principal, { id }, createAdminDeps);
    if (result.ok) return respond(result.status, { ok: true, ...result.data });
    return respond(result.status, { error: result.error, message: result.message });
  };
}
