/**
 * Domains that need help (M13-04): the row shape of `admin_domains_needing_help()`, the sentences
 * that describe it and the registrar guides an admin can copy for the owner. No `server-only`.
 */

export interface DomainHelpRow {
  domain_id: string;
  hostname: string;
  status: string;
  reason: string;
  page_id: string;
  handle: string;
  owner_id: string;
  owner_email: string | null;
  created_at: string;
  age_seconds: number | string;
  last_checked_at: string | null;
}

export interface DomainHelp {
  id: string;
  hostname: string;
  reason: "failed" | "unverified";
  handle: string;
  ownerId: string;
  ownerEmail: string | null;
  createdAt: string;
  ageSeconds: number;
  lastCheckedAt: string | null;
  /** The last check's result in words. */
  result: string;
}

export function describeResult(status: string, lastCheckedAt: string | null): string {
  if (status === "error") return "The last check failed.";
  if (lastCheckedAt === null) return "Never checked.";
  return "Checked, not verified yet.";
}

export function mapDomainHelp(rows: readonly DomainHelpRow[] | null | undefined): DomainHelp[] {
  return (rows ?? []).map((row) => ({
    id: row.domain_id,
    hostname: row.hostname,
    reason: row.reason === "failed" ? "failed" : "unverified",
    handle: row.handle,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
    ageSeconds: Math.max(0, Number(row.age_seconds) || 0),
    lastCheckedAt: row.last_checked_at,
    result: describeResult(row.status, row.last_checked_at),
  }));
}

/** "3 days", "5 hours": the age of a domain, coarse. */
export function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 48 * 3600) {
    const hours = Math.round(seconds / 3600);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const days = Math.round(seconds / 86400);
  return `${days} days`;
}

export const REGISTRAR_GUIDES = [
  { label: "General guide", slug: "connecting-a-domain" },
  { label: "GoDaddy", slug: "connect-a-domain-godaddy" },
  { label: "Namecheap", slug: "connect-a-domain-namecheap" },
  { label: "Squarespace", slug: "connect-a-domain-squarespace" },
  { label: "Cloudflare", slug: "connect-a-domain-cloudflare" },
] as const;

/** The guides' full links on the marketing origin (`rootOrigin`), to paste into a reply. */
export function registrarGuideLinks(marketingOrigin: string): { label: string; url: string }[] {
  return REGISTRAR_GUIDES.map((guide) => ({
    label: guide.label,
    url: `${marketingOrigin}/learn/${guide.slug}`,
  }));
}
