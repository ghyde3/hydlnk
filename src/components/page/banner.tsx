import type { PublishDoc } from "@/lib/document";
import { outboundHref } from "./outbound";

/** The DOM id of the banner and the target of its dismiss anchor (no JavaScript, no cookie). */
export const BANNER_ELEMENT_ID = "pg-banner";

/**
 * The support banner (M9-23): a short message and an optional link in a bar across the top of the
 * page, above the profile. The first thing in `[data-page-root]`, before the column, not sticky.
 *
 *   <aside class="pg-banner" id="pg-banner" aria-label="Message">
 *     <p class="pg-banner-text">{text}</p>
 *     <a class="pg-banner-link" href="/r/{pageId}/{banner id}">{label}</a>   (only with a link)
 *     <a class="pg-banner-dismiss" href="#pg-banner" aria-label="Dismiss message">x</a>
 *   </aside>
 *
 * Dismissal needs no JavaScript, no cookie and no request: the dismiss anchor points at the
 * banner's own id and `.pg-banner:target { display: none }` hides it for as long as the URL keeps
 * `#pg-banner`. A fresh visit shows it again: tenant pages never read or set cookies, which is the
 * accepted cost. The destination is never in the markup: the link goes through `/r/<pageId>/<id>`
 * like every outbound link, and the server reads the address from the published document.
 *
 * The text and the label are React text, so they are escaped. In a thumbnail (the editor's phone
 * dock) the banner is plain text: no link, no dismiss anchor, no id (a small copy of the page holds
 * no anchors, and a second `#pg-banner` would be a duplicate id).
 */
export function Banner({
  banner,
  pageId,
  thumbnail = false,
}: {
  banner: NonNullable<PublishDoc["banner"]>;
  pageId: string;
  thumbnail?: boolean;
}) {
  if (thumbnail) {
    return (
      <div className="pg-banner" data-banner-thumbnail="">
        <p className="pg-banner-text">{banner.text}</p>
      </div>
    );
  }
  const link =
    banner.label !== "" && banner.url !== ""
      ? outboundHref(banner.url, { pageId, id: banner.id })
      : null;
  return (
    <aside className="pg-banner" id={BANNER_ELEMENT_ID} aria-label="Message">
      <p className="pg-banner-text">{banner.text}</p>
      {link && link.href !== undefined ? (
        <a className="pg-banner-link" href={link.href} rel={link.rel}>
          {banner.label}
        </a>
      ) : null}
      <a className="pg-banner-dismiss" href={`#${BANNER_ELEMENT_ID}`} aria-label="Dismiss message">
        {"×"}
      </a>
    </aside>
  );
}

/** The banner a published document draws, or null: it needs a message (a visible one with none draws nothing). */
export function bannerOf(
  doc: Pick<PublishDoc, "banner">,
): NonNullable<PublishDoc["banner"]> | null {
  const banner = doc.banner;
  if (!banner || banner.visible === false || banner.text.trim() === "") return null;
  return banner;
}
