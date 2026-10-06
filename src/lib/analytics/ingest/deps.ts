import "server-only";
import { after } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { rateLimit } from "@/lib/rate-limit";
import { rootOrigin } from "@/lib/routing/urls";
import { verifyLockCode } from "@/lib/links/lock-hash";
import { visitorHash } from "./hash";
import { insertEvent } from "./insert";
import { lookupBeaconPage, resolveClickTarget } from "./pages";
import type { IngestDeps } from "./types";

/** The real dependencies of the two handlers; the routes call these. */
export function ingestDeps(): IngestDeps & { homeHref: string } {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  return {
    // The options pass through untouched: only the lock gate asks for `failClosed` (M9-29).
    rateLimit: (key, limit, windowSeconds, options) =>
      rateLimit(key, limit, windowSeconds, options),
    now: () => new Date(),
    visitorHash,
    insertEvent,
    lookupBeaconPage,
    resolveClickTarget,
    verifyLock: verifyLockCode,
    schedule: (task) => after(task),
    rootDomain,
    homeHref: `${rootOrigin(rootDomain)}/`,
  };
}
