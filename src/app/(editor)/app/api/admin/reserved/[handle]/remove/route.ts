import { removeReservedHandleAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/reserved/{handle}/remove on the app host (M13-08): remove a reservation. Admins only (see adminRoute). */
export const POST = adminRoute(removeReservedHandleAction);
