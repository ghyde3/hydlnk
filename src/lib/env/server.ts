import "server-only";
import { z } from "zod";
import { parseEnv, publicEnvSchema, readPublicEnv } from "./shared";

const serverEnvSchema = publicEnvSchema.extend({
  /** `sb_secret_...`. Bypasses RLS. Server code only; the admin client is the sole consumer. */
  SUPABASE_SECRET_KEY: z.string().min(1),
  // Milestone 4: the variables exist in Vercel already, nothing reads them until then.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
});

/**
 * Every server and public variable, validated when this module is first imported.
 * `server-only` makes importing it from a Client Component a build error.
 */
export const serverEnv = parseEnv(
  serverEnvSchema,
  {
    ...readPublicEnv(),
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  },
  "server",
);

export type ServerEnv = typeof serverEnv;
