import { pickOption, type PublishDoc } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { initialsOf } from "./initials";

/**
 * The small header of a sub-page (M11-06): the site's avatar and profile name, linking to Home. It
 * stands where Home's profile stands, and is not a heading: the page's title is the sub-page's one
 * `<h1>`. The avatar follows the profile's own photo setting (a hidden photo is hidden here too).
 * `link` false (the editor's dock) draws the same box without an anchor.
 */
export function SiteHeader({
  profile,
  link = true,
}: {
  profile: PublishDoc["profile"];
  link?: boolean;
}) {
  const { name, photo } = profile;
  const showPhoto = pickOption("showPhoto", profile.showPhoto);
  const inner = (
    <>
      {showPhoto ? (
        <span
          className="pg-sitehead-avatar"
          data-shape={pickOption("photoShape", profile.photoShape)}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="pg-sitehead-img"
              src={mediaUrl(photo.path)}
              alt=""
              width={40}
              height={40}
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span aria-hidden="true">{initialsOf(name)}</span>
          )}
        </span>
      ) : null}
      <span className="pg-sitehead-name">{name === "" ? "Home" : name}</span>
    </>
  );
  return (
    <header className="pg-sitehead">
      {link ? (
        // A plain anchor on purpose: the live page is static HTML with no router (M8-02).
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a className="pg-sitehead-link" href="/">
          {inner}
        </a>
      ) : (
        <span className="pg-sitehead-link">{inner}</span>
      )}
    </header>
  );
}
