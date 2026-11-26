import "server-only";
import { after } from "next/server";
import { visitorHash } from "@/lib/analytics/ingest/hash";
import { insertEvent } from "@/lib/analytics/ingest/insert";
import { lookupBeaconPage, resolveFormBlock } from "@/lib/analytics/ingest/pages";
import { visitorHashSecret } from "@/lib/analytics/ingest/secret";
import { clientEnv } from "@/lib/env/client";
import { rateLimit, rateLimitAge, rateLimitPeek } from "@/lib/rate-limit";
import { rootOrigin } from "@/lib/routing/urls";
import { renderFormPage } from "@/lib/tenant-render/form-page";
import { notifyOwnerOfLimit, notifyOwnerOfMessage } from "./notify";
import { hasBlockedLink, recordSubmission } from "./store";
import type { FormDeps } from "./submit";

/** The real dependencies of the form routes (the unit tests pass spies instead). */
export function formDeps(): FormDeps {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  return {
    // The default: fail open. The monthly cap in the database is the hard bound.
    rateLimit: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds),
    // The open marker's read: counts nothing, and a store failure reads as "no marker".
    rateLimitAge: (key, windowSeconds) => rateLimitAge(key, windowSeconds),
    // The site's hour, read before the store (it fails open like the limiter).
    rateLimitPeek: (key, limit, windowSeconds) => rateLimitPeek(key, limit, windowSeconds),
    now: () => new Date(),
    visitorHash,
    tokenSecret: visitorHashSecret,
    resolveFormBlock,
    // An invented page id must make no cache entry (M17-05 step 1): misses are not stored.
    lookupSite: (pageId) => lookupBeaconPage(pageId, { cacheMisses: false }),
    renderFormPage,
    hasBlockedLink,
    recordSubmission,
    insertEvent,
    notifyOwnerOfMessage,
    notifyOwnerOfLimit,
    schedule: (task) => after(task),
    rootDomain,
    homeHref: `${rootOrigin(rootDomain)}/`,
  };
}
