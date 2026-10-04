import { IMPACT_LIST_MAX } from "./admin-domain";

/**
 * What adding a blocked domain affects (M7-12): the live pages that already link to it. The count and
 * the list come from `admin_blocked_domain_impact()`, which reads `pages.published` with the same
 * `blocked_links_in()` the save-time check uses. Nothing is unpublished: a page that is already live
 * keeps serving, and its owner meets the block the next time they save or publish a link to it.
 *
 * Pure and client-safe: the server action builds a result from the database rows, the screen draws it.
 */

export interface ImpactPage {
  handle: string;
  /** The distinct hosts of the page's links that match the domain (the domain itself or a subdomain). */
  hosts: string[];
  /** How many links on the page point at the domain. */
  links: number;
}

export interface Impact {
  /** All live pages that link to the domain, not capped by the list. */
  pages: number;
  /** Pages whose DRAFT links to it: their owners see "Not saved" until they change the link. */
  drafts: number;
  /** The first live pages (at most 100), most links first. */
  list: ImpactPage[];
}

/** One row of `admin_blocked_domain_impact()` as PostgREST returns it (a null page_id is "no live page"). */
interface RawImpactRow {
  page_id: string | null;
  handle: string | null;
  hosts: string[] | null;
  link_count: number | null;
  total_pages: number | string | null;
  draft_pages: number | string | null;
}

const isRow = (value: unknown): value is RawImpactRow =>
  typeof value === "object" && value !== null && "total_pages" in value && "draft_pages" in value;

const count = (value: number | string | null): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/**
 * The result of the database function, or a thrown error when it cannot be read: an unreadable answer
 * must never be shown as "no live pages link to it".
 */
export function parseImpact(data: unknown): Impact {
  if (!Array.isArray(data)) throw new Error("The impact check returned no list.");
  if (!data.every(isRow)) throw new Error("The impact check returned an unreadable row.");
  const first = data[0];
  const list: ImpactPage[] = [];
  for (const row of data) {
    if (row.page_id === null || row.handle === null) continue;
    list.push({
      handle: row.handle,
      hosts: Array.isArray(row.hosts) ? row.hosts.filter((h) => typeof h === "string") : [],
      links: count(row.link_count),
    });
    if (list.length >= IMPACT_LIST_MAX) break;
  }
  return {
    pages: first ? count(first.total_pages) : 0,
    drafts: first ? count(first.draft_pages) : 0,
    list,
  };
}

/** "1 live page already links to it." / "3 live pages already link to it." / "No live pages link to it." */
export function impactSentence(pages: number): string {
  if (pages === 0) return "No live pages link to it.";
  if (pages === 1) return "1 live page already links to it.";
  return `${pages} live pages already link to it.`;
}

/** The line under the result when drafts link to the domain too, or null when none do. */
export function draftsSentence(drafts: number): string | null {
  if (drafts <= 0) return null;
  if (drafts === 1)
    return "1 draft also links to it. Its owner will see Not saved until they change the link.";
  return `${drafts} drafts also link to it. Their owners will see Not saved until they change the link.`;
}

/** "shop.example.test · 2 links": the matching hosts, then how many links. */
export function pageDetail(page: ImpactPage): string {
  const links = page.links === 1 ? "1 link" : `${page.links} links`;
  return `${page.hosts.join(", ")} · ${links}`;
}
