/**
 * The pure half of /admin/reserved (M13-08): the row the list draws, the page size and the
 * `?q=&kind=&page=` parsing. No `server-only` and no database, so components and tests import it.
 */

export const RESERVED_PAGE_SIZE = 50;

export type ReservedKind = "system" | "admin";

export interface ReservedRow {
  handle: string;
  reason: string | null;
  kind: ReservedKind;
  addedBy: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** A page already uses this handle (a reservation only stops new claims). */
  held: boolean;
}

export function parseReservedQuery(raw: string | string[] | undefined): string {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return value.trim().toLowerCase().slice(0, 40);
}

export function parseReservedKind(raw: string | string[] | undefined): ReservedKind | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "system" || value === "admin" ? value : null;
}

export function parseReservedPage(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : 1;
}
