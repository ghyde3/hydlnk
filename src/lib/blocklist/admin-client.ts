import { FAILED_MESSAGE } from "./admin-domain";
import type { ImpactPage } from "./admin-impact";

/**
 * The browser half of the blocked-links admin calls (M7-13): a JSON POST with the session cookie that
 * answers with the server's sentence instead of throwing. Client-safe (no server-only imports).
 */

export const SIGNED_OUT_MESSAGE = "You’re signed out. Sign in again.";

export type PostResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** The body of a successful `POST /api/admin/blocked-links`. */
export interface BlockResponse {
  ok: true;
  /** False when the call only wrote the audit row an earlier call was missing. */
  changed: boolean;
  domain: string;
  /** All live pages that already link to the domain. */
  pages: number;
  /** Pages whose draft links to it. */
  drafts: number;
  /** The first live pages (at most 100). */
  list: ImpactPage[];
}

/** POST `body` as JSON to an admin route. A refusal's own sentence comes back as `message`. */
export async function postAdmin<T>(path: string, body: unknown): Promise<PostResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok) return { ok: true, data: (json ?? {}) as T };
    if (response.status === 401) {
      return { ok: false, status: 401, message: SIGNED_OUT_MESSAGE };
    }
    const message = typeof json?.message === "string" ? json.message : FAILED_MESSAGE;
    return { ok: false, status: response.status, message };
  } catch {
    return { ok: false, status: 0, message: FAILED_MESSAGE };
  }
}
