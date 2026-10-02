import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { accountHasPage, claimHandle } from "@/lib/handles/claim";
import { PENDING_HANDLE_COOKIE } from "@/lib/handles/pending";
import { clearPendingMetadata, readPendingHandle } from "@/lib/handles/pending-server";
import { appOrigin } from "@/lib/routing/urls";

export const dynamic = "force-dynamic";

function redirectTo(path: string): NextResponse {
  // Built from NEXT_PUBLIC_ROOT_DOMAIN, never from the request: nothing in the URL steers it.
  const response = NextResponse.redirect(
    new URL(path, appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * GET /claim/resume (app host): claims the handle the user chose on /signup (M1-12, M1-13, M1-14).
 * /claim sends signed-in accounts without a page here when a pending handle is waiting; this is a
 * route handler because it has to clear the pending-handle cookie, which a page cannot do.
 *
 *   claimed                       -> /editor
 *   account already has a page    -> /editor (nothing is created)
 *   taken in the meantime         -> /claim with the "was taken while you were signing up" notice
 *   any other refusal             -> /claim with the field prefilled (it shows the live status)
 *
 * The pending handle is read from the user's own metadata or cookie and re-validated by the claim;
 * the owner is the verified session user. The cookie and the metadata are cleared on every path, and
 * every path ends on a URL that does not come back here, so this cannot loop.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return redirectTo("/login");

  const handle = await readPendingHandle();
  let target = "/claim?pending=done";

  if (handle) {
    if (await accountHasPage(user.id)) {
      target = "/editor";
    } else {
      const result = await claimHandle(user.id, handle);
      if (result.ok || result.error === "page_limit") {
        target = "/editor";
      } else {
        const reason = result.error === "taken" ? "&reason=taken" : "";
        target = `/claim?pending=done&handle=${encodeURIComponent(handle)}${reason}`;
      }
    }
    await clearPendingMetadata(user.id);
  }

  const response = redirectTo(target);
  response.cookies.delete(PENDING_HANDLE_COOKIE);
  return response;
}
