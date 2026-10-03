import type { DomainConfig, ProjectDomain } from "./vercel-client";
import type { DomainRecord } from "./types";

/**
 * Builds the DNS records of step 2 from what Vercel returned for this domain (M4-13). Pure and the
 * only place records are made. Nothing here knows a Vercel address, an IP or a CNAME target: the
 * values are copied from the API responses, so a change on Vercel's side shows up at once and a
 * response without them yields "unavailable", never a fallback.
 *
 *   subdomain  CNAME  <host relative to Vercel's apexName>  <recommendedCNAME rank 1, trailing dot dropped>
 *   apex       A      @                                      <recommendedIPv4 rank 1, first address>
 *   ownership  TXT    <challenge domain relative to the apex> <challenge value>   one per TXT challenge
 *
 * The root-domain note under a subdomain's table ("Using a root domain like example.test instead?
 * Add an A record for @ pointing to 203.0.113.10.") is `apex`: Vercel's apex name and its first IPv4.
 */
export interface BuiltRecords {
  records: DomainRecord[];
  apex: { name: string; ipv4: string } | null;
  /** True when the response could not give a record to show (no apex name, no CNAME, no IPv4). */
  unavailable: boolean;
}

const byRank = <T extends { rank: number }>(list: T[]): T[] =>
  [...list].sort((a, b) => a.rank - b.rank);

/** The host relative to `apex`: "links", "a.b", or "@" for the apex itself. */
export function relativeName(host: string, apex: string): string {
  const h = host.toLowerCase();
  const a = apex.toLowerCase();
  if (h === a) return "@";
  if (h.endsWith(`.${a}`)) return h.slice(0, -(a.length + 1));
  return h;
}

export function buildRecords(
  hostname: string,
  domain: Pick<ProjectDomain, "apexName" | "verification">,
  config: Pick<DomainConfig, "recommendedCNAME" | "recommendedIPv4">,
): BuiltRecords {
  const apexName = domain.apexName;
  if (!apexName) return { records: [], apex: null, unavailable: true };

  const ipv4 = byRank(config.recommendedIPv4)[0]?.value[0];
  const isApex = hostname.toLowerCase() === apexName.toLowerCase();
  const records: DomainRecord[] = [];

  if (isApex) {
    if (!ipv4) return { records: [], apex: null, unavailable: true };
    records.push({ type: "A", name: "@", value: ipv4 });
  } else {
    const target = byRank(config.recommendedCNAME)[0]?.value;
    if (!target) return { records: [], apex: null, unavailable: true };
    records.push({
      type: "CNAME",
      name: relativeName(hostname, apexName),
      value: target.endsWith(".") ? target.slice(0, -1) : target,
    });
  }

  for (const challenge of domain.verification) {
    if (challenge.type.toUpperCase() !== "TXT" || !challenge.domain || !challenge.value) continue;
    records.push({
      type: "TXT",
      name: relativeName(challenge.domain, apexName),
      value: challenge.value,
    });
  }

  return {
    records,
    apex: !isApex && ipv4 ? { name: apexName, ipv4 } : null,
    unavailable: false,
  };
}
