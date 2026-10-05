import type { Metadata } from "next";
import {
  shareDescriptionOf,
  shareTitleOf,
  type PublishDoc,
  type SubPagePublish,
} from "@/lib/document";

/**
 * The metadata of a published tenant page, for the handle route and the custom-domain route alike
 * (M2-22, M2-30, M6-32). One function, so both routes say the same thing.
 *
 *   <title>             "{name} - links": the share card never changes it
 *   <meta description>  the bio, as before
 *   og:title, twitter:title                the share title, else the display name
 *   og:description, twitter:description    the share description, else the bio
 *   og:image, twitter:image                the page's own /og URL, passed in
 *
 * A page with no share card gets exactly the values it had before M6-32. Next.js renders these
 * values into `content` attributes and escapes them, so a share title is text and never markup.
 */
export function pageMetadata(
  document: PublishDoc,
  urls: { page: string; image: string },
): Metadata {
  const { profile, share } = document;
  const description = profile.bio || undefined;
  const cardTitle = shareTitleOf(share, profile.name);
  const cardDescription = shareDescriptionOf(share, profile.bio) || undefined;
  return {
    title: `${profile.name} - links`,
    description,
    openGraph: {
      type: "website",
      title: cardTitle,
      description: cardDescription,
      url: urls.page,
      images: [{ url: urls.image, width: 1200, height: 630, alt: profile.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: cardTitle,
      description: cardDescription,
      images: [urls.image],
    },
  };
}

/**
 * The metadata of a published sub-page (M11-10): the title "{page title} · {profile name}" (the
 * profile name is the public one; the site's private name is never read here), the page's own
 * description, a canonical URL on the site's primary host and the site's OG image. The share card
 * is Home's, so it is not used here: the page speaks for itself. `urls.page` is the page's address
 * on the primary host (the verified custom domain when there is one), `urls.image` the site's /og.
 */
export function subPageMetadata(
  document: Pick<PublishDoc, "profile">,
  subPage: Pick<SubPagePublish, "title" | "description">,
  urls: { page: string; image: string },
): Metadata {
  const { profile } = document;
  const title = profile.name === "" ? subPage.title : `${subPage.title} · ${profile.name}`;
  const description = subPage.description || undefined;
  return {
    title,
    description,
    alternates: { canonical: urls.page },
    openGraph: {
      type: "website",
      title,
      description,
      url: urls.page,
      images: [{ url: urls.image, width: 1200, height: 630, alt: profile.name }],
    },
    twitter: { card: "summary_large_image", title, description, images: [urls.image] },
  };
}
