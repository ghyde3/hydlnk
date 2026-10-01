import { z } from "zod";

/**
 * 3-30 chars: lowercase letters, digits and hyphens, no leading or trailing hyphen.
 * Whether the handle is reserved or taken is the database's job (`reserved_handles`, unique index).
 */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export const handleSchema = z.string().regex(HANDLE_PATTERN, {
  error: "Use 3-30 lowercase letters, numbers or hyphens, not starting or ending with a hyphen",
});
