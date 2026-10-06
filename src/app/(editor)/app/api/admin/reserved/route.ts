import { addReservedHandleAction } from "@/lib/admin/actions";
import { adminRoute } from "@/lib/admin/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/reserved on the app host (M13-08): reserve a handle. Admins only (see adminRoute). */
export const POST = adminRoute(addReservedHandleAction);
