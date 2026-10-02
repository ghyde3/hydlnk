import { NextResponse } from "next/server";
import { publicQueryCount, queryCounterEnabled } from "@/lib/publish/query-counter";
import { lookupPageId } from "../../../published-page";

export const dynamic = "force-dynamic";

/**
 * GET /hl-query-count on a tenant host: how often the public query really read Postgres for this
 * page (M2-26). A test hook, answering only when HYDLNK_QUERY_COUNTER=1 is set on the server;
 * otherwise a plain 404, exactly like any other unknown path. Reads no page content.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }) {
  if (!queryCounterEnabled()) return new NextResponse(null, { status: 404 });
  const { handle } = await params;
  const pageId = await lookupPageId(handle);
  if (!pageId) return new NextResponse(null, { status: 404 });
  return NextResponse.json(
    { pageId, count: publicQueryCount(pageId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
