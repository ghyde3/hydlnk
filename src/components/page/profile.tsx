import type { CSSProperties, ReactNode } from "react";
import {
  PHOTO_SIZE_PX,
  nameFontStack,
  pickOption,
  resolveNameStyle,
  type PublishDoc,
} from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { initialsOf } from "./initials";

/** The closed class of each name size (M9-24); `medium` has none: it is the base rule, today's size. */
export const NAME_SIZE_CLASS = {
  small: "pg-name-s",
  medium: null,
  large: "pg-name-l",
  xlarge: "pg-name-xl",
} as const;

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
 * The logo and the name's own style (M9-24), all optional and defaulted, so a page that uses none
 * has the markup it always had:
 *   - `logo` with `logoPlacement` "beside" (the default) draws a row `.pg-logo-row`: the logo
 *     `<img class="pg-logo" alt="">` and the name `<h1>` side by side; "instead" draws the
 *     `<h1 class="pg-name">` holding the logo `<img alt="{display name}">` and no visible text, so
 *     the name stays the accessible name. In every combination there is exactly one `h1` named
 *     the display name: with the name hidden (or empty) the logo shows on its own and the hidden
 *     heading keeps the name for assistive technology;
 *   - `nameSize` is a closed class (`pg-name-s`, `pg-name-l`, `pg-name-xl`; none for medium, which
 *     is today's size) and `nameFont` is `pg-name-font` plus the family's stack as `--t-font-name`,
 *     built from the allowlist constant (`nameFontStack`), never from a tenant string. The heading
 *     weight token and every other font stay as they are;
 *   - the image has `width` and `height` from the stored size, is eager (above the fold) and
 *     follows the name's size (1.25em, in the stylesheet), so nothing shifts when it loads.
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
  const logo = profile.logo ?? null;
  const style = resolveNameStyle(profile);
  const sizeClass = NAME_SIZE_CLASS[style.nameSize];
  const nameClass = ["pg-name", sizeClass, style.nameFont ? "pg-name-font" : null]
    .filter((part) => part !== null)
    .join(" ");
  // Spread, never `style={undefined}`: an undefined prop reaches a server component's flight data.
  const nameStyle = style.nameFont
    ? { style: { "--t-font-name": nameFontStack(style.nameFont) } as CSSProperties }
    : {};
  const logoImage = (alt: string) =>
    logo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="pg-logo"
        src={mediaUrl(logo.path)}
        alt={alt}
        width={logo.width}
        height={logo.height}
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    ) : null;
  // The name line: with a logo, the logo beside the name, instead of it, or alone (a hidden or empty
  // name); without one, the name as it always was.
  let nameBlock: ReactNode = null;
  if (logo && nameShown && style.logoPlacement === "instead") {
    nameBlock = (
      <h1 className={nameClass} data-profile-part="name" {...nameStyle}>
        {logoImage(name)}
      </h1>
    );
  } else if (logo) {
    const rowClass = ["pg-logo-row", sizeClass].filter((part) => part !== null).join(" ");
    nameBlock = (
      <div className={rowClass}>
        {logoImage("")}
        {nameShown ? (
          <h1 className={nameClass} data-profile-part="name" {...nameStyle}>
            {name}
          </h1>
        ) : null}
      </div>
    );
  } else if (nameShown) {
    nameBlock = (
      <h1 className={nameClass} data-profile-part="name" {...nameStyle}>
        {name}
      </h1>
    );
  }

  // The heading of a page whose name is hidden: still the page's one <h1>, in the accessibility
  // tree, but 1px and clipped. Never rendered for an empty name (nothing to read).
  const hiddenHeading =
    !showName && name !== "" ? (
      <h1 className="pg-name" data-visually-hidden="">
        {name}
      </h1>
    ) : null;

  if (!showPhoto && nameBlock === null && !bioShown) return hiddenHeading;

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
      {nameBlock}
      {bioShown ? (
        <p className="pg-bio" data-profile-part="bio">
          {bio}
        </p>
      ) : null}
    </header>
  );
}
