import "server-only";
import { clientEnv } from "@/lib/env/client";
import { invalidatePage } from "@/lib/publish/invalidate";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { DomainDeps } from "./deps";
import { sendDomainLiveEmail } from "./email";
import { serverEmailEnv } from "./email-env";
import type { VercelClient } from "./vercel-client";
import { vercelClient } from "./vercel";

/**
 * Expires the cached public page of `pageId`: its og:url names the page's domain, so adding,
 * verifying, re-pointing and removing one changes it. The one place that touches page tags is
 * src/lib/publish/invalidate.ts.
 */
export const expireDomainPage = invalidatePage;

/** A client that builds the real one (and reads the environment) per call: a missing token fails at the call. */
const lazyVercel: VercelClient = {
  addProjectDomain: (hostname) => vercelClient().addProjectDomain(hostname),
  getProjectDomain: (hostname) => vercelClient().getProjectDomain(hostname),
  verifyProjectDomain: (hostname) => vercelClient().verifyProjectDomain(hostname),
  getDomainConfig: (hostname) => vercelClient().getDomainConfig(hostname),
  removeProjectDomain: (hostname) => vercelClient().removeProjectDomain(hostname),
};

/** The real wiring: secret-key database client, the Vercel API, the page cache and the email. */
export function createDomainDeps(): DomainDeps {
  return {
    admin: createAdminSupabase(),
    vercel: lazyVercel,
    expirePage: expireDomainPage,
    sendLiveEmail: async ({ to, hostname }) => {
      await sendDomainLiveEmail({ to, hostname }, serverEmailEnv());
    },
    rootDomain: clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
    rateLimit: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds),
    log: (message) => console.error(message),
  };
}
