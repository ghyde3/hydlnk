import "server-only";
import { isStalePending } from "@/components/domains/view-model";
import type { DomainView } from "@/lib/domains/types";
import { listDomainsForAccount } from "@/lib/domains/queries";

export interface DomainCardData {
  domain: DomainView;
  /** Pending for 48 hours or more (M5-18): decided here, once, from createdAt. */
  stale: boolean;
}

/**
 * The account's domains for the Domains screen, oldest first, each with whether it has been pending
 * for 48 hours. Everything comes from the server-only query (domains-core), which reads only this
 * account's rows and carries each domain's creation time.
 */
export async function loadDomainCards(
  accountId: string,
  now: number = Date.now(),
): Promise<DomainCardData[]> {
  const domains = await listDomainsForAccount(accountId);
  return domains.map((domain) => ({
    domain,
    stale: domain.status !== "verified" && isStalePending(domain.createdAt, now),
  }));
}
