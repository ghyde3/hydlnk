import { adminClient } from "../fixtures/auth";
import { rand } from "../fixtures/data";

/**
 * Helpers for the blocked-links specs (M7-12, M7-13): a random domain per test that is removed again,
 * the two route paths, and secret-key reads of the table and the audit log.
 */

const created: string[] = [];

/** A random, never-real domain, remembered so the spec's cleanup removes it. */
export function newDomain(label = "bl"): string {
  const domain = `${label}-${rand(8)}.example.test`;
  created.push(domain);
  return domain;
}

/** Remembers a domain a test adds through the screen by some other spelling (a long one, say). */
export function trackDomain(domain: string): string {
  created.push(domain);
  return domain;
}

export const track = {
  /** Removes every domain this file made (the audit rows stay: the log is append-only). */
  async cleanup(): Promise<void> {
    const domains = created.splice(0);
    if (domains.length > 0) {
      await adminClient().from("blocked_domains").delete().in("domain", domains);
    }
  },
};

export const blockPath = () => "/api/admin/blocked-links";
export const removePath = (domain: string, encode = true) =>
  `/api/admin/blocked-links/${encode ? encodeURIComponent(domain) : domain}/remove`;

export interface DomainRow {
  domain: string;
  reason: string | null;
  added_by: string | null;
  created_at: string;
}

export async function domainRow(domain: string): Promise<DomainRow | null> {
  const { data, error } = await adminClient()
    .from("blocked_domains")
    .select("domain, reason, added_by, created_at")
    .eq("domain", domain)
    .maybeSingle();
  if (error) throw new Error(`domainRow failed: ${error.message}`);
  return data as DomainRow | null;
}

/** The block and unblock audit rows of a domain, oldest first. */
export async function auditRows(domain: string): Promise<
  {
    admin_id: string;
    action: string;
    account_id: string | null;
    report_id: string | null;
    detail: Record<string, unknown>;
  }[]
> {
  const { data, error } = await adminClient()
    .from("admin_audit")
    .select("admin_id, action, account_id, report_id, detail")
    .in("action", ["block_domain", "unblock_domain"])
    .eq("detail->>domain", domain)
    .order("id");
  if (error) throw new Error(`auditRows failed: ${error.message}`);
  return (data ?? []) as never;
}

/** A visible link block with a fixed id. */
export const linkBlock = (id: string, url: string) => ({
  id,
  type: "link" as const,
  visible: true,
  label: "Shop",
  url,
});
