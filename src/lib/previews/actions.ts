"use server";

import "server-only";
import { isAccountSuspended } from "@/lib/admin/suspension";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { rateLimit } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/routing/urls";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  createPreviewLinkCore,
  listPreviewLinksCore,
  revokePreviewLinkCore,
  type PreviewDeps,
} from "./core";
import type {
  CreatePreviewLinkResult,
  ListPreviewLinksResult,
  RevokePreviewLinkResult,
} from "./types";

/**
 * The share link's Server Actions (M6-09): create, list and turn off the private preview links of a
 * page. They run with the secret key (the `preview_links` table has no client access at all), so
 * each one takes the user from the verified session and checks ownership itself (see ./core). Every
 * Free, Pro and Studio account can use them. The token is returned by `createPreviewLink` once and
 * only its hash is stored. This module is `server-only`: importing it from client code fails the
 * build, and the secret key never reaches the browser.
 */

function deps(): PreviewDeps {
  return {
    admin: createAdminSupabase(),
    isSuspended: isAccountSuspended,
    limit: rateLimit,
    appOrigin: appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN),
  };
}

export async function createPreviewLink(pageId: string): Promise<CreatePreviewLinkResult> {
  const user = await getSessionUser();
  return createPreviewLinkCore(deps(), user?.id ?? null, pageId);
}

export async function listPreviewLinks(pageId: string): Promise<ListPreviewLinksResult> {
  const user = await getSessionUser();
  return listPreviewLinksCore(deps(), user?.id ?? null, pageId);
}

export async function revokePreviewLink(linkId: string): Promise<RevokePreviewLinkResult> {
  const user = await getSessionUser();
  return revokePreviewLinkCore(deps(), user?.id ?? null, linkId);
}
