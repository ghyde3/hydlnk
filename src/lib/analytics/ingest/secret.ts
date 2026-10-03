import "server-only";
import { serverEnv } from "@/lib/env/server";

/**
 * The secret behind the visitor hash and the rate-limit buckets (VISITOR_HASH_SECRET). Required on
 * every Vercel build and deployment by the server environment schema, so production always has it.
 * Off Vercel (a local `next dev`, CI) it may be unset: a fixed, public value stands in, so the
 * tracking routes work out of the box. That value protects nothing and is never used on Vercel.
 */
const LOCAL_DEV_SECRET = "hydlnk-local-development-visitor-hash-secret";

export function visitorHashSecret(): string {
  const configured = serverEnv.VISITOR_HASH_SECRET;
  if (configured) return configured;
  if (serverEnv.VERCEL_ENV === undefined) return LOCAL_DEV_SECRET;
  throw new Error("Missing server environment variable VISITOR_HASH_SECRET.");
}
