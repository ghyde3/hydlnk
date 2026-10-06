import { blockAppAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/apps/block on the app host (M13-10): revoke an app for everyone. Admins only (see adminRoute). */
export const POST = adminRoute(blockAppAction);
