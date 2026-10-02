import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import type { BillingResult } from "./result";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export const jsonError = (status: number, error: string, message?: string) =>
  NextResponse.json(message ? { error, message } : { error }, { status, headers: NO_STORE });

/**
 * A cross-site form cannot start Checkout or open the portal as the signed-in user: when the
 * browser says where the request came from, it must be the app host itself. Requests that carry
 * neither header (curl, a server) pass this check and still need the session.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) return false;
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

/** True for a browser's own form navigation (not fetch, not curl): the case that needs a page, not JSON. */
function isNavigation(request: NextRequest): boolean {
  return request.headers.get("sec-fetch-mode") === "navigate";
}

/**
 * The form fields of a POST, exactly the names in `allowed`, each at most once. Accepts a form
 * body (urlencoded or multipart) or a small JSON object of strings. Returns null for anything
 * else: a field that is not listed (a price id, a customer id, a plan under another name), a
 * repeated field, a non-string value or an unreadable body. Nothing is ever read from the query string.
 */
export async function readFields(
  request: NextRequest,
  allowed: readonly string[],
): Promise<Record<string, string> | null> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  try {
    if (type.startsWith("application/json")) {
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
      for (const [key, value] of Object.entries(body)) {
        if (!allowed.includes(key) || typeof value !== "string") return null;
        out[key] = value;
      }
      return out;
    }
    if (
      type.startsWith("application/x-www-form-urlencoded") ||
      type.startsWith("multipart/form-data")
    ) {
      const form = await request.formData();
      for (const key of new Set(form.keys())) {
        const values = form.getAll(key);
        const value = values[0];
        if (!allowed.includes(key) || values.length !== 1 || typeof value !== "string") return null;
        out[key] = value;
      }
      return out;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The HTTP answer for a helper's result: 303 to the Stripe URL, or the error as JSON with its
 * status. A browser form navigation that fails is sent back to Settings instead of a JSON page,
 * with the code in `billing_error` (see `billingMessage`).
 */
export function answer(request: NextRequest, result: BillingResult): NextResponse {
  if (result.ok) return NextResponse.redirect(result.url, { status: 303, headers: NO_STORE });
  if (isNavigation(request)) {
    const back = new URL("/settings", appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN));
    back.searchParams.set("billing_error", result.error);
    return NextResponse.redirect(back, { status: 303, headers: NO_STORE });
  }
  return jsonError(result.status, result.error, result.message);
}

/** 401 for a caller without a session (a navigation goes to /login). */
export function unauthenticated(request: NextRequest): NextResponse {
  if (isNavigation(request)) {
    return NextResponse.redirect(new URL("/login", appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)), {
      status: 303,
      headers: NO_STORE,
    });
  }
  return jsonError(401, "unauthenticated");
}
