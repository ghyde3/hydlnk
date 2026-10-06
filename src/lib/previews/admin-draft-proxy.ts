import type { NextRequest, NextResponse } from "next/server";
import { rewriteWithSession } from "@/lib/routing/session";
import { setShareHeaders, shareContentSecurityPolicy, shareNonce } from "./share-headers";

/**
 * The admin's read-only view of a draft (M13-11) lives at `/admin-draft/{pageId}` on the app host
 * (and `/admin-draft/{pageId}/{path}` for a page of the site). It draws a draft that never passed
 * Publish on the origin that holds the session cookies, exactly like the share preview, so it gets
 * the share preview's response headers: a per-request script nonce policy, `private, no-store`,
 * noindex, no Referer. Unlike the share link it needs the session (the page's `requireAdmin` reads
 * it), so it goes through `rewriteWithSession` and overlays the share headers on the result.
 */
export const ADMIN_DRAFT_PREFIX = "/admin-draft";

/** True for "/admin-draft/{something}": exactly "/admin-draft" is an unknown path. */
export function isAdminDraftPath(pathname: string): boolean {
  return (
    pathname.startsWith(`${ADMIN_DRAFT_PREFIX}/`) && pathname.length > ADMIN_DRAFT_PREFIX.length + 1
  );
}

export async function adminDraftProxy(
  request: NextRequest,
  destination: URL,
): Promise<NextResponse> {
  const nonce = shareNonce();
  const csp = shareContentSecurityPolicy(nonce);
  const response = await rewriteWithSession(request, destination, {
    // Replaces whatever the client sent, so a visitor can never choose the nonce a page renders under.
    "content-security-policy": csp,
  });
  setShareHeaders(response.headers, nonce);
  return response;
}
