import { clearAnnouncementAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/announcement/{id}/clear on the app host (M13-09): clear it. Admins only (see adminRoute). */
export const POST = adminRoute(clearAnnouncementAction);
