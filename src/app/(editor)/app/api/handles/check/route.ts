import { NextResponse, type NextRequest } from "next/server";
import { checkHandle } from "@/lib/handles/availability";

// Reads Postgres on every request; never cache an availability answer.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/handles/check?handle=... on the app host (M1-02). The only route to handle
 * availability: reserved_handles is server-only and pages has no public select. The response
 * carries exactly {handle, status}, nothing else. Any other method gets Next.js's automatic 405.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("handle") ?? "";
  try {
    const { handle, status } = await checkHandle(raw);
    return NextResponse.json({ handle, status }, { headers: NO_STORE });
  } catch (error) {
    console.error("[handles] availability check failed", error);
    return NextResponse.json({ error: "check_failed" }, { status: 500, headers: NO_STORE });
  }
}
