import { z } from "zod";

/** The keyset cursor: the last row's sort value (null when it has none) and its id, the tie-breaker. */
const CursorSchema = z.tuple([z.string().max(2000).nullable(), z.uuid()]);

export type ListCursor = z.infer<typeof CursorSchema>;

export function encodeCursor(sortValue: string | null, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id]), "utf8").toString("base64url");
}

/** The cursor, or null when it was not made by encodeCursor (a tampered or foreign one). */
export function decodeCursor(raw: unknown): ListCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4000) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed = CursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
