import { blockDomainAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/blocked-links on the app host (M7-12): block a domain. Admins only (see adminRoute). */
export const POST = adminRoute(blockDomainAction);
