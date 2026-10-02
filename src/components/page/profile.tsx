import type { PublishDoc } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { initialsOf } from "./initials";

/**
 * Avatar, display name and bio. The avatar is the photo (the name is its `alt`) or, without one,
 * the initials. An empty name or bio renders no element at all.
 */
export function Profile({ profile }: { profile: PublishDoc["profile"] }) {
  const { name, bio, photo } = profile;
  return (
    <header className="pg-profile">
      <div className="pg-avatar">
        {photo ? (
          // A plain <img>: `path` is a validated reference into the page-media bucket, so
          // next/image would add nothing but a remotePatterns list.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="pg-avatar-img"
            src={mediaUrl(photo.path)}
            alt={name}
            width={96}
            height={96}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span aria-hidden="true">{initialsOf(name)}</span>
        )}
      </div>
      {name === "" ? null : <h1 className="pg-name">{name}</h1>}
      {bio === "" ? null : <p className="pg-bio">{bio}</p>}
    </header>
  );
}
