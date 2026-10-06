import "server-only";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { testHooksEnabled } from "@/lib/env/test-hooks";
import { invalidatePage } from "@/lib/publish/invalidate";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { DomainDeps } from "./deps";
import { sendDomainLiveEmail } from "./email";
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
      await sendDomainLiveEmail(
        { to, hostname },
        {
          SMTP_HOST: serverEnv.SMTP_HOST,
          SMTP_PORT: serverEnv.SMTP_PORT,
          SMTP_USER: serverEnv.SMTP_USER,
          SMTP_PASS: serverEnv.SMTP_PASS,
          EMAIL_FROM: serverEnv.EMAIL_FROM,
          MAILPIT_URL: process.env.MAILPIT_URL,
          VERCEL_ENV: serverEnv.VERCEL_ENV,
          // The end-to-end harness (CI's browser suite runs `next start` with the test hooks on, never
          // on a Vercel production deployment) sends like local development, to Mailpit: its specs read
          // the "your domain is live" email there (M9-13).
          NODE_ENV: testHooksEnabled() ? "test" : serverEnv.NODE_ENV,
        },
      );
    },
    rootDomain: clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
    rateLimit: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds),
    log: (message) => console.error(message),
  };
}
