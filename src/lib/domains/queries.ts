import "server-only";
import { createDomainDeps } from "./deps-server";
import { getDomainView, listDomainViews, pollDomainView } from "./core";
import { POLL_COOLDOWN_SECONDS } from "./verify";
import type { DomainView } from "./types";

/**
 * Server-only reads of the Domains screen and the polling route. Each takes the verified account
 * id and returns only that account's domains; a pending domain carries its DNS records, fetched
 * fresh from Vercel (two GETs, never a verify request) on every call.
 */

/** All of the account's domains, oldest first. */
export function listDomainsForAccount(accountId: string): Promise<DomainView[]> {
  return listDomainViews(createDomainDeps(), accountId);
}

/** One of the account's domains, or null when it does not exist or belongs to someone else (no Vercel call then). */
export function getDomainState(accountId: string, id: string): Promise<DomainView | null> {
  return getDomainView(createDomainDeps(), accountId, id);
}

/**
 * What GET /api/domains/[id] answers: the same read, after the shared verification routine with
 * its cooldown, so a tab that polls is also what notices a domain going live.
 */
export function pollDomainState(accountId: string, id: string): Promise<DomainView | null> {
  return pollDomainView(createDomainDeps(), accountId, id, POLL_COOLDOWN_SECONDS);
}
