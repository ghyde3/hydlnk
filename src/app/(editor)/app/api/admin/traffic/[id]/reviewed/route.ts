import { reviewTrafficFlagAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/traffic/{id}/reviewed on the app host (M5-10). Admins only (see adminRoute). */
export const POST = adminRoute(reviewTrafficFlagAction);
