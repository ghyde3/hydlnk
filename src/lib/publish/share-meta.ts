import type { Metadata } from "next";
import { shareDescriptionOf, shareTitleOf, type PublishDoc } from "@/lib/document";

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
