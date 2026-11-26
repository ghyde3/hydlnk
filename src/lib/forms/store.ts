import "server-only";
import { findBlockedLinks } from "@/lib/blocklist/check";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { RECORD_STATUSES, type FormKind, type RecordStatus } from "./contract";

/**
 * The two database calls of a submission (M17-06), with the secret key. Errors carry the SQLSTATE
 * only: a Supabase error's message or details can quote the row's values (the visitor's address).
 */

export interface SubmissionRecord {
  siteId: string;
  blockId: string;
  /** The sub-page that holds the form; null for Home. */
  entryId: string | null;
  kind: FormKind;
  email: string;
  name: string;
  message: string;
  visitorHash: string;
}

export class FormStoreError extends Error {
  constructor(
    readonly step: string,
    readonly code: string,
  ) {
    super(`${step} failed (${code})`);
  }
}

/** `record_form_submission` (the migration's SQL surface): the status and the site's owner. */
export async function recordSubmission(
  row: SubmissionRecord,
): Promise<{ status: RecordStatus; ownerId: string | null }> {
  const { data, error } = await createAdminSupabase().rpc("record_form_submission", {
    p_site_id: row.siteId,
    p_block_id: row.blockId,
    // A null entry id is a Home form; the generated types spell the argument as a string.
    p_entry_id: row.entryId as string,
    p_kind: row.kind,
    p_email: row.email,
    p_name: row.name,
    p_message: row.message,
    p_visitor_hash: row.visitorHash,
  });
  if (error) throw new FormStoreError("record_form_submission", error.code ?? "unknown");
  const first = Array.isArray(data) ? data[0] : undefined;
  const status = RECORD_STATUSES.find((value) => value === first?.status);
  if (!status) throw new FormStoreError("record_form_submission", "unreadable");
  return { status, ownerId: first?.owner_id ?? null };
}

/** `http(s)://…` for a bare `www.` host, so the blocklist's URL parser reads its host. */
function asUrl(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

/**
 * True when a link of a message points to a host on the link blocklist (M5-03, `blocked_domains`):
 * the same `blocked_links_in` the pages use, on a stand-in document of one link per block. Only a
 * blocked domain counts; an IP literal or a single-label host in a message is left to the owner.
 * Throws when the blocklist cannot answer, so the route refuses (503) rather than letting a blocked
 * link through.
 */
export async function hasBlockedLink(links: readonly string[]): Promise<boolean> {
  if (links.length === 0) return false;
  const doc = { blocks: links.map((link, index) => ({ id: `link${index}`, url: asUrl(link) })) };
  try {
    const found = await findBlockedLinks(createAdminSupabase(), doc);
    return found.some((link) => link.reason === "blocked_domain");
  } catch {
    throw new FormStoreError("blocked_links_in", "unavailable");
  }
}
