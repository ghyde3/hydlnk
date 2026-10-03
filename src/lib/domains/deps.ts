import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { VercelClient } from "./vercel-client";

/**
 * What the domain logic (core.ts, verify.ts, view.ts) needs from the outside, so the same code runs
 * against the real environment (./deps-server), a Vitest fake and the Playwright integration specs
 * (a real database and the local Vercel stub). No `server-only` import in this graph.
 */
export interface DomainDeps {
  /** Secret-key client: RLS does not apply, so every function here checks ownership itself. */
  admin: SupabaseClient<Database>;
  vercel: VercelClient;
  /** Expires the cached public page of `pageId` (its og:url names the domain), best effort. */
  expirePage: (pageId: string) => void;
  /** Sends the "domain is live" email; rejects on failure (the caller logs and carries on). */
  sendLiveEmail: (input: { to: string; hostname: string }) => Promise<void>;
  /** NEXT_PUBLIC_ROOT_DOMAIN, so the hostname validator refuses the deployment's own domain. */
  rootDomain?: string;
  /** Logs one line; never pass it an address, a token or a hostname-with-credentials. */
  log?: (message: string) => void;
}
