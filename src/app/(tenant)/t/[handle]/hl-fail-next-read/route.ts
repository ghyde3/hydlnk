import { NextResponse, type NextRequest } from "next/server";
import { armFailNextRead } from "@/lib/tenant-render/fault";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /hl-fail-next-read on a tenant host: arms a one-shot failure of the next database read for
 * this host's handle (or, with `?page=<id>`, for that page id; with `?off=1`, disarms it), so a spec
 * can prove the 500 panel and that a failure is never cached (M8-03, M8-04). A test hook that
 * answers only when HYDLNK_QUERY_COUNTER=1 is set on the server; otherwise a plain 404, exactly like
 * any other unknown path. Reads nothing and shows nothing of any page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const page = request.nextUrl.searchParams.get("page");
  const armed = request.nextUrl.searchParams.get("off") === null;
  const target = page !== null && UUID.test(page) ? { pageId: page } : { handle };
  if (!armFailNextRead(target, armed)) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ armed }, { headers: { "Cache-Control": "no-store" } });
}
