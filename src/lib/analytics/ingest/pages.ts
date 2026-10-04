import "server-only";
import { unstable_cache } from "next/cache";
import { publishedDocSchema } from "@/lib/document";
import { PAGE_REVALIDATE_SECONDS, PUBLIC_READ_CACHE_VERSION, pageTag } from "@/lib/publish/tags";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { clientEnv } from "@/lib/env/client";
import { tenantOrigin } from "@/lib/publish/urls";
import { customOrigin } from "@/lib/routing/urls";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolveLink } from "./link-target";
import type { BeaconPage, ClickTarget } from "./types";
import type { ContactCard } from "./vcard";

/**
 * The two reads the tracking routes make, both with the secret key (RLS does not apply, so these
 * queries are the access rule): only a PUBLISHED page of an account that is not suspended is ever
 * returned, and nothing but the published document is read for a click.
 */

/**
 * For the view beacon: the handle and the verified custom hosts of a published page, which are what
 * the Origin check compares against. Null for an unknown id, a page with nothing published and a
 * suspended owner. The document itself is never read. Throws when the database fails.
 */
export async function lookupBeaconPage(pageId: string): Promise<BeaconPage | null> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("handle, accounts!inner(suspended_at), domains(hostname, status)")
    .eq("id", pageId)
    .not("published", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Loading page ${pageId} for a view failed: ${error.message}`);
  if (!data || data.accounts.suspended_at !== null) return null;
  return {
    handle: data.handle,
    customHosts: (data.domains ?? [])
      .filter((domain) => domain.status === "verified")
      .map((domain) => domain.hostname.toLowerCase()),
  };
}

/** What the cached click read hands back: plain JSON, so the data cache can store it. */
type PublishedRead =
  { found: true; published: unknown; handle: string; customHosts: string[] } | { found: false };

async function readPublished(pageId: string): Promise<PublishedRead> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("published, handle, accounts!inner(suspended_at), domains(hostname, status)")
    .eq("id", pageId)
    .maybeSingle();
  // A database failure is an error, not a "not found": nobody should be told a link is gone
  // because Postgres hiccuped (and the data cache never stores a throw).
  if (error)
    throw new Error(`Loading published page ${pageId} for a click failed: ${error.message}`);
  if (!data || data.published === null || data.accounts.suspended_at !== null) {
    return { found: false };
  }
  return {
    found: true,
    published: data.published,
    handle: data.handle,
    customHosts: (data.domains ?? [])
      .filter((domain) => domain.status === "verified")
      .map((domain) => domain.hostname.toLowerCase()),
  };
}

/**
 * Cached under the page's tag, like the public page itself: Publish expires the tag, so a link
 * edited and republished redirects to its new URL at once, and a suspension or deletion drops it.
 * `next dev` reads Postgres every time (the same rule as `published-page.ts`).
 */
function readPublishedCached(pageId: string): Promise<PublishedRead> {
  if (process.env.NODE_ENV !== "production") return readPublished(pageId);
  return unstable_cache(
    readPublished,
    ["click-target", "host-bound", PUBLIC_READ_CACHE_VERSION, pageId],
    {
      tags: [pageTag(pageId)],
      revalidate: PAGE_REVALIDATE_SECONDS,
    },
  )(pageId);
}

/**
 * The link with this id in the page's published document, with the handle and verified custom hosts
 * of its page (the hosts the redirect may be served on), its lock and its UTM-tagged destination
 * (M9-27, M9-29: `resolveLink`), or null: unknown page,
 * nothing published, suspended owner, a document that fails the published schema, an id that is not
 * a link, or a URL that is not plain http(s).
 */
export async function resolveClickTarget(pageId: string, id: string): Promise<ClickTarget | null> {
  const read = await readPublishedCached(pageId);
  if (!read.found) return null;
  const parsed = publishedDocSchema.safeParse(read.published);
  if (!parsed.success) return null;
  const link = resolveLink(parsed.data, id);
  return link === null
    ? null
    : {
        url: link.url,
        ...(link.lock ? { lock: link.lock } : {}),
        handle: read.handle,
        customHosts: read.customHosts,
      };
}

/**
 * The contact block with this id in the page's published document, for "Save contact" (M9-18): its
 * stored fields, the page's public address (its primary custom domain when one is verified, else
 * its handle host, decided here and never from the request) and the hosts that may serve the
 * download. Null for an unknown page, nothing published, a suspended owner, a document that fails
 * the published schema, an id that is not a visible contact block (a hidden one, another type, a
 * draft-only one). Throws when the database fails.
 */
export async function resolveContactCard(
  pageId: string,
  blockId: string,
): Promise<ContactCard | null> {
  const read = await readPublishedCached(pageId);
  if (!read.found) return null;
  const parsed = publishedDocSchema.safeParse(read.published);
  if (!parsed.success) return null;
  const block = parsed.data.blocks.find(
    (candidate) => candidate.id === blockId && candidate.type === "contact",
  );
  if (!block || block.type !== "contact" || block.visible === false) return null;
  const hostname = await getPrimaryDomain(pageId);
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  return {
    name: block.name,
    phone: block.phone,
    email: block.email,
    hours: block.hours,
    pageUrl: hostname ? `${customOrigin(hostname, rootDomain)}/` : `${tenantOrigin(read.handle)}/`,
    handle: read.handle,
    customHosts: read.customHosts,
  };
}
