import "server-only";
import { cookies } from "next/headers";
import type { AppPage } from "@/lib/auth/gate";
import { CURRENT_PAGE_COOKIE, pickCurrentPage } from "./pick";

export { CURRENT_PAGE_COOKIE };

/**
 * The site every page-scoped screen works on: the one named by the host-only `hl-page` cookie when
 * it is one of the user's own pages or an active site shared with them (Wave F), otherwise their
 * oldest own page, or with none of their own the oldest shared one. The cookie is a preference,
 * never a permission: it only picks among the sites the gate listed, under RLS (own pages carry
 * the owner filter; shared ones are what the policies return), and the context re-checks access.
 */
export async function getCurrentPage<P extends Pick<AppPage, "id" | "created_at">>(
  user: { id: string },
  pages: readonly (P & { owner_id?: string })[],
  shared: readonly P[] = [],
): Promise<P> {
  const own = pages.filter((page) => page.owner_id === undefined || page.owner_id === user.id);
  const store = await cookies();
  const requested = store.get(CURRENT_PAGE_COOKIE)?.value;
  const match = [...own, ...shared].find((page) => page.id === requested);
  return match ?? pickCurrentPage(own.length > 0 ? own : shared, undefined);
}
