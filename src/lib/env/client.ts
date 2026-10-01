import { parseEnv, publicEnvSchema, readPublicEnv } from "./shared";

/**
 * Public environment, safe in server and client code. Validated when this module is first
 * imported, so a missing variable stops the app (and `next build`) with a message that names it.
 * Only NEXT_PUBLIC_* variables are read here. For the secret key use "@/lib/env/server".
 */
export const clientEnv = parseEnv(publicEnvSchema, readPublicEnv(), "client");

export type ClientEnv = typeof clientEnv;
