import "server-only";
import { cookies } from "next/headers";
import type { AppPage } from "@/lib/auth/gate";
import { CURRENT_PAGE_COOKIE, pickCurrentPage } from "./pick";

export { CURRENT_PAGE_COOKIE };

/**
 * The page every page-scoped screen works on: the one named by the host-only `hl-page` cookie
 * when it is one of the signed-in user's own pages, otherwise their oldest page. The cookie is a
 * preference, never a permission: a missing value, a garbage value and another user's page id all
 * fall back to the oldest page. `pages` comes from the gate, read under RLS, so it holds the
 * user's own rows only; the owner check below is a second guard in case a caller passes more.
 */
export async function getCurrentPage<P extends Pick<AppPage, "id" | "created_at">>(
  user: { id: string },
  pages: readonly (P & { owner_id?: string })[],
): Promise<P> {
  const own = pages.filter((page) => page.owner_id === undefined || page.owner_id === user.id);
  const store = await cookies();
  return pickCurrentPage(own, store.get(CURRENT_PAGE_COOKIE)?.value);
}
