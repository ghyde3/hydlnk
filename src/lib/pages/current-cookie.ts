import "server-only";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env/client";
import { protocolFor } from "@/lib/routing/urls";
import { CURRENT_PAGE_COOKIE } from "./pick";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Stores the current site's id in the host-only `hl-page` cookie (M1-18). Only for an id the caller
 * has just checked through the access helper (the switcher, an accepted invite). No `domain`
 * attribute: the cookie belongs to the app host and tenant hosts never receive it.
 */
export async function setCurrentPageCookie(pageId: string): Promise<void> {
  (await cookies()).set(CURRENT_PAGE_COOKIE, pageId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: protocolFor(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN) === "https",
    maxAge: ONE_YEAR_SECONDS,
  });
}
