import { dismissReportAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/reports/{id}/dismiss on the app host (M5-06). Admins only (see adminRoute). */
export const POST = adminRoute(dismissReportAction);
