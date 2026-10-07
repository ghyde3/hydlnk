/**
 * The pure half of /admin/apps (M13-10): the row the list draws. No `server-only`, no database.
 * Everything here is a count or a name an app chose (shown as text); no person, token or tool content.
 */

export interface AppRow {
  clientId: string;
  /** What the app calls itself: untrusted text. */
  name: string;
  kind: "dcr" | "cimd";
  blockedAt: string | null;
  blockedReason: string | null;
  activeConnections: number;
  calls7d: number;
  errors7d: number;
  lastCallAt: string | null;
}

/** Where a metadata client lives (its client id is its address), or "Registered automatically". */
export function appOrigin(row: Pick<AppRow, "clientId" | "kind">): string {
  if (row.kind === "dcr") return "Registered automatically";
  try {
    return new URL(row.clientId).host;
  } catch {
    return "Unknown address";
  }
}
