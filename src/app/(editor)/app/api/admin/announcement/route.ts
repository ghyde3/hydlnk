import { setAnnouncementAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/announcement on the app host (M13-09): set the announcement. Admins only (see adminRoute). */
export const POST = adminRoute(setAnnouncementAction);
