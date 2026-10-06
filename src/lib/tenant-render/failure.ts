import "server-only";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { errorReference } from "@/lib/error-copy";
import { htmlResponse } from "./html-response";
import { errorDocument } from "./state-pages";

/**
 * The 500 of a tenant address (M5-20, M8-03, M8-04): the panel, `Cache-Control: no-store`, `noindex`,
 * and a reference id that is also the id of the server log line (`[error {id}]` with the error).
 * Never a 404: nobody should be told a page does not exist because the database blinked.
 *
 * Never cached either. The route is a static route handler, and Next.js stores whatever a static
 * handler returns, a 500 included, until the entry is regenerated. The platform's CDN does not keep
 * it (`no-store`), but a self-hosted server (`next start`, the CI cache checks) would go on answering
 * the panel. So the failing response is kept out of the cache twice:
 *
 *   1. it registers a one-second `revalidate` and a tag of its own (through `unstable_cache`, the
 *      only way a static handler can add either), so even if the next step fails the entry is stale
 *      a second later;
 *   2. after the response, the tag is expired through the cache handler: the same
 *      `revalidateTag(tags)` call Next.js itself makes. `revalidateTag` from `next/cache` throws
 *      inside a statically generated handler, so this goes to the incremental cache the render was
 *      handed (`globalThis.__incrementalCache`, which Next.js stores for exactly this). The next
 *      request finds the entry expired, regenerates it and reads the database again.
 *
 * An expiry only counts against an entry written BEFORE it, and `after()` can run before Next.js has
 * stored the entry (it starts when the handler returns, not when the entry is written), so step 2
 * waits 40 milliseconds first, and runs once more 400 ms later in case the write was slow. A client
 * that asks again inside the first 40 ms (a script on the same machine; not a visitor tapping Retry)
 * can be handed the panel once more, and no request after that can. Both steps are best effort and
 * never throw: a failing failure path would be a worse 500. The unit test and
 * tests/e2e/m8/render-cache.spec.ts pin the behavior on a production build.
 */

export const FAILURE_TAG = "tenant-failure";
export const FAILURE_REVALIDATE_SECONDS = 1;
/** Milliseconds after the handler returns at which the failure tag is expired: after the entry is written. */
export const FAILURE_EXPIRE_AFTER_MS = [40, 400] as const;

type CacheHandle = { revalidateTag?: (tags: string[]) => Promise<void> | void };

async function keepOutOfCache(): Promise<void> {
  // `next dev` never caches a tenant page, and its cache has nothing to evict.
  if (process.env.NODE_ENV !== "production") return;
  try {
    await unstable_cache(async () => true, ["tenant-failure"], {
      revalidate: FAILURE_REVALIDATE_SECONDS,
      tags: [FAILURE_TAG],
    })();
    after(async () => {
      let waited = 0;
      for (const at of FAILURE_EXPIRE_AFTER_MS) {
        await new Promise((resolve) => setTimeout(resolve, at - waited));
        waited = at;
        try {
          const cache = (globalThis as { __incrementalCache?: CacheHandle }).__incrementalCache;
          await cache?.revalidateTag?.([FAILURE_TAG]);
        } catch (error) {
          console.error("[tenant] could not expire the failure entry", error);
        }
      }
    });
  } catch (error) {
    console.error("[tenant] could not keep the failure out of the cache", error);
  }
}

/** The response for a render that threw. `error` is logged with the reference, never shown. */
export async function failureResponse(error: unknown): Promise<Response> {
  const reference = errorReference(error as { digest?: string } | null);
  console.error(`[error ${reference}]`, error);
  await keepOutOfCache();
  return htmlResponse(errorDocument(reference), 500, { "Cache-Control": "no-store" });
}
