import { z } from "zod";

/**
 * The one email schema for every auth form and action (client and server). Trims, caps at 254
 * characters (the SMTP limit) and requires a dotted domain: 'a@b' and 'a b@c.com' are rejected.
 */
export const EMAIL_ERROR = "Enter a valid email address.";

export const emailSchema = z
  .string({ error: EMAIL_ERROR })
  .trim()
  .max(254, { error: EMAIL_ERROR })
  .pipe(z.email({ error: EMAIL_ERROR }));
