import { unblockDomainAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/blocked-links/{domain}/remove on the app host (M7-12). Admins only (see adminRoute). */
export const POST = adminRoute(unblockDomainAction);
