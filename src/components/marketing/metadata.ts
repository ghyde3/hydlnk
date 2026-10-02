import type { Metadata } from "next";

/** Open Graph images under public/marketing/og (1200 x 630, rendered from the site's own type). */
export type OgImage =
  | "home"
  | "features"
  | "design"
  | "domains"
  | "analytics"
  | "pricing"
  | "learn"
  | "faq"
  | "legal";

/**
 * Per-page metadata: title, description, canonical URL and the Open Graph / Twitter card. Paths
 * are relative; the marketing layout's metadataBase makes them absolute on the root host.
 */
export function marketingMetadata({
  path,
  title,
  description,
  image,
}: {
  path: string;
  /** A page title ("Pricing" -> "Pricing | HYDLNK"), or `{ absolute }` for the full title. */
  title: string | { absolute: string };
  description: string;
  image: OgImage;
}): Metadata {
  const full = typeof title === "string" ? `${title} | HYDLNK` : title.absolute;
  const images = [
    {
      url: `/marketing/og/${image}.jpg`,
      width: 1200,
      height: 630,
      alt: full,
    },
  ];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "HYDLNK",
      locale: "en_US",
      url: path,
      title: full,
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: full,
      description,
      images,
    },
  };
}
