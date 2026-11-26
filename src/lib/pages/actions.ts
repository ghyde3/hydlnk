"use server";

import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { protocolFor } from "@/lib/routing/urls";
import { siteAccessFor } from "@/lib/access/server";
import { CURRENT_PAGE_COOKIE } from "./pick";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Switches the current page (M1-18). Stores the id in the host-only `hl-page` cookie, but only
 * when the caller may read the site (their own, or an active one shared with them, Wave F): another
 * user's id (or garbage) finds nothing and the cookie is left alone. The client refreshes the route afterwards.
 * No `domain` attribute: the cookie belongs to the app host and tenant hosts never receive it.
 */
export async function selectPage(pageId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user || typeof pageId !== "string" || !UUID.test(pageId)) return { ok: false };

  // Own or shared (Wave F, the one helper): a site the caller may read, else the cookie is left alone.
  const found = await siteAccessFor({
    actorId: user.id,
    siteId: pageId.toLowerCase(),
    need: "read",
    source: "editor",
  });
  if (!found.ok) return { ok: false };
  const data = { id: found.access.siteId };

  const store = await cookies();
  store.set(CURRENT_PAGE_COOKIE, data.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: protocolFor(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN) === "https",
    maxAge: ONE_YEAR_SECONDS,
  });
  return { ok: true };
}
