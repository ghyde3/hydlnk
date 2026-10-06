import { PLAN_LIMITS, toPlanId } from "@/lib/limits/table";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import type { PublishDoc } from "@/lib/document";

/**
 * Redirect mode (M9-31): a published page whose document has `redirect: {linkId}`, owned by an
 * account whose plan includes the mode, answers GET and HEAD with a `302` to the click redirect of
 * that link instead of the page. `/r/<pageId>/<linkId>` then counts the click, adds the UTM tags and
 * goes to the destination, so the owner's analytics still see it.
 *
 * Everything here is decided from the published document and the owner's plan, both read with the
 * page and cached under the page's tag, so Publish, a plan change, a suspension and a domain change
 * expire a cached redirect exactly as they expire the page. Nothing from the request is read: not a
 * header, not the query string, not the Host. `Location` is a relative path built only from the page
 * id (the database row's) and the link id (checked against the document), so it cannot be steered.
 *
 * Never a 301 or a 308 (turning the mode off must take effect), and no `Cache-Control: immutable`.
 * A redirect that cannot be resolved (the plan no longer includes it, the link is gone, hidden or
 * locked: a stored document that bypassed Publish) is ignored and the page renders normally.
 */

/** The link id redirect mode points at, or null when the page should render normally. */
export function redirectTargetId(document: PublishDoc, plan: string): string | null {
  const redirect = document.redirect;
  if (!redirect) return null;
  // A downgraded account never redirects: the draft keeps the key, the live page shows the page.
  if (!PLAN_LIMITS[toPlanId(plan)].redirectMode) return null;
  const block = document.blocks.find((candidate) => candidate.id === redirect.linkId);
  if (!block || block.type !== "link" || block.lock !== undefined) return null;
  return findLinkUrl(document, block.id) === null ? null : block.id;
}

/** The 302 of a page in redirect mode, or null when the page renders normally. */
export function redirectModeResponse(page: {
  pageId: string;
  document: PublishDoc;
  plan: string;
}): Response | null {
  const linkId = redirectTargetId(page.document, page.plan);
  if (linkId === null) return null;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/r/${page.pageId}/${linkId}`,
      // `next dev` stores nothing, so it says so; a production response carries no Cache-Control of
      // its own and Next.js writes the one that follows from the route's revalidate time.
      ...(process.env.NODE_ENV === "production" ? {} : { "Cache-Control": "no-store" }),
    },
  });
}
