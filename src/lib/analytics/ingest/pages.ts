import "server-only";
import { unstable_cache } from "next/cache";
import { PAGE_REVALIDATE_SECONDS, PUBLIC_READ_CACHE_VERSION, pageTag } from "@/lib/publish/tags";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { clientEnv } from "@/lib/env/client";
import { tenantOrigin } from "@/lib/publish/urls";
import { customOrigin } from "@/lib/routing/urls";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolveLink } from "./link-target";
import { buildBlockIndex, documentForBlock, type SiteRead } from "./site-index";
import type { BeaconPage, ClickTarget } from "./types";
import type { ContactCard } from "./vcard";

/**
 * The two reads the tracking routes make, both with the secret key (RLS does not apply, so these
 * queries are the access rule): only a PUBLISHED page of an account that is not suspended is ever
 * returned, and nothing but the published document is read for a click.
 */

/** What the cached beacon read hands back: plain JSON, so the data cache can store it. */
type BeaconRead = { found: true; page: BeaconPage } | { found: false };

async function readBeaconPage(pageId: string): Promise<BeaconRead> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select(
      "handle, accounts!inner(suspended_at), domains(hostname, status), site_pages(id, published_at)",
    )
    .eq("id", pageId)
    .not("published", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Loading page ${pageId} for a view failed: ${error.message}`);
  if (!data || data.accounts.suspended_at !== null) return { found: false };
  return {
    found: true,
    page: {
      handle: data.handle,
      customHosts: (data.domains ?? [])
        .filter((domain) => domain.status === "verified")
        .map((domain) => domain.hostname.toLowerCase()),
      // Live = published (published_at is set together with `published`); a draft-only page is not live.
      subPageIds: (data.site_pages ?? [])
        .filter((subPage) => subPage.published_at !== null)
        .map((subPage) => subPage.id.toLowerCase()),
    },
  };
}

/**
 * For the view beacon: the handle, the verified custom hosts and the live sub-page ids of a published
 * site, which is what the Origin check and the sub-page check compare against. One read per site,
 * cached under the site's tag like the click read (Publish, a domain change and a suspension all
 * expire it), so a view costs no query of its own; `next dev` reads Postgres every time. Null for an
 * unknown id, a site with nothing published and a suspended owner. The documents are never read.
 * Throws when the database fails.
 */
export async function lookupBeaconPage(pageId: string): Promise<BeaconPage | null> {
  const read =
    process.env.NODE_ENV !== "production"
      ? await readBeaconPage(pageId)
      : await unstable_cache(
          readBeaconPage,
          ["beacon-page", "host-bound", PUBLIC_READ_CACHE_VERSION, pageId],
          { tags: [pageTag(pageId)], revalidate: PAGE_REVALIDATE_SECONDS },
        )(pageId);
  return read.found ? read.page : null;
}

/** What the cached click read hands back: plain JSON, so the data cache can store it. */
type PublishedRead =
  ({ found: true; handle: string; customHosts: string[] } & SiteRead) | { found: false };

async function readPublished(pageId: string): Promise<PublishedRead> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select(
      "published, handle, accounts!inner(suspended_at), domains(hostname, status), site_pages(id, published)",
    )
    .eq("id", pageId)
    .maybeSingle();
  // A database failure is an error, not a "not found": nobody should be told a link is gone
  // because Postgres hiccuped (and the data cache never stores a throw).
  if (error)
    throw new Error(`Loading published page ${pageId} for a click failed: ${error.message}`);
  if (!data || data.published === null || data.accounts.suspended_at !== null) {
    return { found: false };
  }
  // Published sub-pages only, oldest id order for a stable index; a draft is never read.
  const subPages = (data.site_pages ?? [])
    .filter((subPage) => subPage.published !== null)
    .map((subPage) => ({ id: subPage.id.toLowerCase(), published: subPage.published as unknown }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    found: true,
    home: data.published,
    subPages,
    index: buildBlockIndex(data.published, subPages),
    handle: data.handle,
    customHosts: (data.domains ?? [])
      .filter((domain) => domain.status === "verified")
      .map((domain) => domain.hostname.toLowerCase()),
  };
}

/**
 * The site read of a click (M11-09): Home's published document, the published sub-pages and the
 * site-wide block index, cached under the site's tag, like the public page itself: Publish expires
 * the tag, so a link edited and republished redirects to its new URL at once, and a suspension or
 * deletion drops it. A click costs no query and one document parse, however many pages the site has.
 * `next dev` reads Postgres every time (the same rule as `published-page.ts`).
 */
function readPublishedCached(pageId: string): Promise<PublishedRead> {
  if (process.env.NODE_ENV !== "production") return readPublished(pageId);
  return unstable_cache(
    readPublished,
    ["click-target", "site-index", PUBLIC_READ_CACHE_VERSION, pageId],
    {
      tags: [pageTag(pageId)],
      revalidate: PAGE_REVALIDATE_SECONDS,
    },
  )(pageId);
}

/**
 * The link with this id in the site's published documents (Home or a live sub-page), with the handle
 * and verified custom hosts of its site (the hosts the redirect may be served on), its lock, its
 * UTM-tagged destination (M9-27, M9-29: `resolveLink`) and the sub-page that holds it, or null:
 * unknown site, nothing published, suspended owner, a document that fails the published schema, an id
 * that is not a link, or a URL that is not plain http(s).
 */
export async function resolveClickTarget(pageId: string, id: string): Promise<ClickTarget | null> {
  const read = await readPublishedCached(pageId);
  if (!read.found) return null;
  const holder = documentForBlock(read, id);
  if (!holder) return null;
  const link = resolveLink(holder.doc, id);
  return link === null
    ? null
    : {
        url: link.url,
        ...(link.lock ? { lock: link.lock } : {}),
        ...(holder.subPageId ? { subPageId: holder.subPageId } : {}),
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
  const holder = documentForBlock(read, blockId);
  if (!holder) return null;
  const block = holder.doc.blocks.find(
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
    ...(holder.subPageId ? { subPageId: holder.subPageId } : {}),
  };
}
