import { giftPlanAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/accounts/{id}/gift on the app host (M13-07). Admins only (see adminRoute). */
export const POST = adminRoute(giftPlanAction);
