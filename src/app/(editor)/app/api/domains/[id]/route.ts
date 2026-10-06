import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { pollDomainState } from "@/lib/domains/queries";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/domains/[id] on the app host (M4-15): the owner's domain as a `DomainView`, the thing
 * the Domains screen polls while a domain is pending (every 10 seconds, every 30 after five
 * minutes, only while the tab is visible, for at most 30 minutes). It runs the shared verification
 * routine with its cooldown, so a polling tab is also what notices a domain going live, and it is
 * what "Try again" calls after the DNS records could not be loaded.
 *
 *   401  nobody is signed in
 *   404  no such domain, or one that belongs to another account (no Vercel call is made)
 *   200  the DomainView (never cached)
 *
 * The id is a path segment only; the account is the verified session user.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }
  const { id } = await params;
  try {
    const view = await pollDomainState(user.id, id);
    if (!view) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json(view, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error("[domains] polling failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
