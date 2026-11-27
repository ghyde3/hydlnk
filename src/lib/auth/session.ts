import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ensureAccount } from "./accounts";

export interface SessionUser {
  id: string;
  email: string;
  /**
   * How this session was signed in: the JWT's `amr` methods ("otp", "oauth", "password", ...).
   * Accepting an invite needs one that proved the inbox (S1: never a password alone).
   */
  methods: string[];
}

/** The `amr` claim's method names (Supabase writes `[{ method, timestamp }]`; plain strings too). */
export function authMethods(amr: unknown): string[] {
  if (!Array.isArray(amr)) return [];
  return amr.flatMap((entry: unknown) => {
    const method =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? (entry as { method?: unknown }).method
          : undefined;
    return typeof method === "string" && method !== "" ? [method] : [];
  });
}

/**
 * The signed-in user, from verified JWT claims (`getClaims()`), or null. Never `getSession()` and
 * never the mere presence of a cookie: a forged or garbage `sb-...-auth-token` value fails the
 * verification and reads as signed out.
 *
 * Cached per request, so layouts and pages that both ask pay for one verification.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return null;
    const { sub, email, amr } = data.claims as { sub?: unknown; email?: unknown; amr?: unknown };
    if (typeof sub !== "string" || sub === "") return null;
    return { id: sub, email: typeof email === "string" ? email : "", methods: authMethods(amr) };
  } catch {
    return null;
  }
});

/**
 * Like getSessionUser, but sends a signed-out visitor to /login (no return-URL parameter, ever)
 * and self-heals the `accounts` row (M1-05) so every signed-in page can rely on it.
 */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureAccount(user.id);
  return user;
});
