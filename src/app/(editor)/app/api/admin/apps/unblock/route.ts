import { unblockAppAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/apps/unblock on the app host (M13-10): restore an app. Admins only (see adminRoute). */
export const POST = adminRoute(unblockAppAction);
