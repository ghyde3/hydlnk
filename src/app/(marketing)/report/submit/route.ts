import { handleReportRequest } from "@/lib/reports/handler";
import { reportDeps } from "@/lib/reports/server";

/**
 * POST /report/submit on the marketing host (M5-05): the report form's endpoint. No session, no
 * cookies: anyone may report a page. Everything that matters (validation, the per-reporter limit,
 * the 24-hour repeat rule, the hashed IP) is in src/lib/reports; the table is server-only.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleReportRequest(request, reportDeps());
}
