import { suspendAccountAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/accounts/{id}/suspend on the app host (M5-07). Admins only (see adminRoute). */
export const POST = adminRoute(suspendAccountAction);
