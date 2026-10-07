import { recheckDomainAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/domains/{id}/recheck on the app host (M13-04): verify one domain now. Admins only. */
export const POST = adminRoute(recheckDomainAction);
