import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

/**
 * What the page's footer shows, decided by the caller (the public page from the owner's plan, the
 * editor preview from the same rule), never by the page document: a tenant cannot add or remove
 * either link through the draft.
 */
export interface PageChrome {
  /** The "Made with HYDLNK" link (free plans). */
  badge: boolean;
  /** Destination of the "Report this page" link, or null for no link. */
  reportHref: string | null;
  /** Where the badge points; defaults to the HYDLNK root origin. */
  badgeHref?: string;
}

/**
 * The footer slot. Not a block: no block id, no click tracking. Renders nothing when there is
 * nothing to show, so a page without a badge or report link has no empty gap.
 */
export function PageFooter({ chrome }: { chrome: PageChrome }) {
  const { badge, reportHref } = chrome;
  if (!badge && !reportHref) return null;
  return (
    <footer className="pg-footer" data-page-footer="">
      {badge ? (
        <a
          className="pg-footer-link"
          href={chrome.badgeHref ?? rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}
          rel="noopener"
        >
          Made with HYDLNK
        </a>
      ) : null}
      {reportHref ? (
        <a className="pg-footer-link" href={reportHref} rel="noopener">
          Report this page
        </a>
      ) : null}
    </footer>
  );
}
