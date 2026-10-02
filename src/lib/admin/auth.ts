import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { clientEnv } from "@/lib/env/client";
import { createServerSupabase } from "@/lib/supabase/server";
import { readAdminUserIds } from "./env";
import { ANONYMOUS, principalFromClaims, type Principal } from "./principal";

export interface AdminIdentity {
  id: string;
  email: string;
}

/**
 * The caller, from verified JWT claims (`getClaims()`: the signature is checked, a forged or
 * garbage cookie reads as anonymous). Admin status is ADMIN_USER_IDS matched against the verified
 * subject (see `principal.ts` for the one extra, localhost-only marker). Nothing here reads a
 * request field. Cached per request, so a layout and a page that both ask pay once.
 */
export const getPrincipal = cache(async (): Promise<Principal> => {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return ANONYMOUS;
    return principalFromClaims(data.claims, {
      adminIds: readAdminUserIds(),
      rootDomain: clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
    });
  } catch {
    return ANONYMOUS;
  }
});

/**
 * Gate for every admin page and layout: signed out goes to /login (no return-URL parameter),
 * a signed-in non-admin gets the app's 404, identical to an unknown route, and an admin gets
 * `{ id, email }`. The admin mutations are not guarded here but in `executeAdminAction`
 * (`./execute.ts`), which answers 401 and 403 as HTTP statuses.
 *
 * Keep a `loading.tsx` out of the segments above the callers, or the redirect and the 404 arrive
 * as a streamed 200.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const principal = await getPrincipal();
  if (principal.kind === "anonymous") redirect("/login");
  if (!principal.admin) notFound();
  return { id: principal.id, email: principal.email };
}

/** True when the signed-in caller is an admin (the sidebar's Admin link). Never redirects or 404s. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const principal = await getPrincipal();
  return principal.kind === "user" && principal.admin;
}
