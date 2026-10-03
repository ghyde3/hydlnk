import { PHOTO_SIZE_PX, pickOption, type PublishDoc } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { initialsOf } from "./initials";

/**
 * Avatar, display name and bio. The avatar is the photo (the name is its `alt`) or, without one,
 * the initials. An empty name or bio renders no element at all.
 *
 * Display options (M6-15, M6-17), all optional in a stored document and defaulted when missing, so
 * an older page looks as it always did:
 *   - `photoShape`, `photoSize`, `photoBorder` reach the stylesheet as `data-shape`, `data-size`
 *     and `data-border` on `.pg-avatar`. Each goes through `pickOption`, which only ever returns a
 *     member of its fixed list, so no tenant string lands in an attribute;
 *   - `showPhoto: false` draws no avatar at all, not even the initials;
 *   - `showName: false` keeps the `<h1>` with the display name but hides it visually (the clip
 *     technique, not `display: none`), so the page keeps its heading and the name stays readable
 *     to a screen reader. It carries no `data-profile-part`, so it is not a tap target;
 *   - `showBio: false` draws no bio.
 * With the photo, the name and the bio all hidden there is no header at all, so the first block
 * starts at the column's top padding; the hidden heading is out of the layout (absolute).
 *
 * `data-profile-part` marks what a tap in the editor's preview can open (`avatar`, `name`, `bio`,
 * M6-03); it is on the live page too, so the markup is the same everywhere. `data-block-id`
 * ("profile") is set only for the editor's preview (`editable`).
 */
export function Profile({
  profile,
  editable = false,
}: {
  profile: PublishDoc["profile"];
  editable?: boolean;
}) {
  const { name, bio, photo } = profile;
  const showPhoto = pickOption("showPhoto", profile.showPhoto);
  const showName = pickOption("showName", profile.showName);
  const showBio = pickOption("showBio", profile.showBio);
  const nameShown = showName && name !== "";
  const bioShown = showBio && bio !== "";

  // The heading of a page whose name is hidden: still the page's one <h1>, in the accessibility
  // tree, but 1px and clipped. Never rendered for an empty name (nothing to read).
  const hiddenHeading =
    !showName && name !== "" ? (
      <h1 className="pg-name" data-visually-hidden="">
        {name}
      </h1>
    ) : null;

  if (!showPhoto && !nameShown && !bioShown) return hiddenHeading;

  const size = pickOption("photoSize", profile.photoSize);
  const px = PHOTO_SIZE_PX[size];
  return (
    // Spread, not `data-block-id={undefined}`: an undefined prop still reaches the page's inline
    // flight data as "$undefined", and a public page must not contain the editor's attribute.
    <header className="pg-profile" {...(editable ? { "data-block-id": "profile" } : {})}>
      {hiddenHeading}
      {showPhoto ? (
        <div
          className="pg-avatar"
          data-profile-part="avatar"
          data-shape={pickOption("photoShape", profile.photoShape)}
          data-size={size}
          data-border={pickOption("photoBorder", profile.photoBorder)}
        >
          {photo ? (
            // A plain <img>: `path` is a validated reference into the page-media bucket, so
            // next/image would add nothing but a remotePatterns list.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="pg-avatar-img"
              src={mediaUrl(photo.path)}
              alt={name}
              width={px}
              height={px}
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span aria-hidden="true">{initialsOf(name)}</span>
          )}
        </div>
      ) : null}
      {nameShown ? (
        <h1 className="pg-name" data-profile-part="name">
          {name}
        </h1>
      ) : null}
      {bioShown ? (
        <p className="pg-bio" data-profile-part="bio">
          {bio}
        </p>
      ) : null}
    </header>
  );
}
