"use server";

import { getSessionUser } from "@/lib/auth/session";
import { addDomain, checkDomain, removeDomain, setDomainPage } from "./core";
import { createDomainDeps } from "./deps-server";
import { DOMAIN_MESSAGES, DOMAIN_STATUS } from "./messages";
import type { DomainActionResult } from "./types";

/**
 * Server actions of the Domains screen (M4-11, M4-12, M4-15, M4-17). Every one returns
 * `{ ok: true, domain? }` or `{ ok: false, error, message, status }` (see types.ts) and never
 * throws for an expected refusal. The caller is the verified session user (`getClaims()`), never a
 * request field; ids and hostnames from the client are validated and ownership is checked on every
 * call, so another account's domain or page is a plain refusal that never reaches Vercel.
 *
 * (A "use server" file exports async functions only: the logic and its tests live in ./core.)
 */

async function signedIn(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id ?? null;
}

const signedOut = (): DomainActionResult => ({
  ok: false,
  error: "unauthenticated",
  message: DOMAIN_MESSAGES.signedOut,
  status: DOMAIN_STATUS.unauthenticated,
});

/** Adds a custom domain for one of the caller's pages. FormData fields: `hostname`, `pageId`. */
export async function addDomainAction(
  input: FormData | { hostname: string; pageId: string },
): Promise<DomainActionResult> {
  const userId = await signedIn();
  if (!userId) return signedOut();
  const hostname = input instanceof FormData ? input.get("hostname") : input?.hostname;
  const pageId = input instanceof FormData ? input.get("pageId") : input?.pageId;
  return addDomain(createDomainDeps(), userId, { hostname, pageId });
}

/** "Check DNS now": asks Vercel to verify the domain, with a 10 second cooldown. */
export async function checkDomainAction(id: string): Promise<DomainActionResult> {
  const userId = await signedIn();
  if (!userId) return signedOut();
  return checkDomain(createDomainDeps(), userId, id);
}

/** Changes which of the caller's pages a domain serves (the "Serves" select). */
export async function setDomainPageAction(id: string, pageId: string): Promise<DomainActionResult> {
  const userId = await signedIn();
  if (!userId) return signedOut();
  return setDomainPage(createDomainDeps(), userId, id, pageId);
}

/** Removes the domain at Vercel and then its row (M4-17). */
export async function removeDomainAction(id: string): Promise<DomainActionResult> {
  const userId = await signedIn();
  if (!userId) return signedOut();
  return removeDomain(createDomainDeps(), userId, id);
}
