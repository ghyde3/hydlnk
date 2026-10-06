/**
 * The photographs on the home page's "Link in bio for" band, one for each audience page. They are
 * generated images of fictional people (see assets/audience-sources/ for the sources and prompts),
 * stored as AVIF and WebP under public/marketing/audiences/. Platform photos are 560 wide and
 * creator photos 800 wide; the sizes here are the stored files' own, so the browser can hold space.
 */
export interface AudienceImage {
  src: string;
  width: number;
  height: number;
  alt: string;
}

function image(slug: string, width: number, height: number, alt: string): AudienceImage {
  return { src: `/marketing/audiences/${slug}`, width, height, alt };
}

export const AUDIENCE_IMAGES: Readonly<Record<string, AudienceImage>> = {
  tiktok: image(
    "tiktok",
    560,
    750,
    "A woman laughing in a bright apartment, filming a short vertical video on a phone set on a small tripod.",
  ),
  instagram: image(
    "instagram",
    560,
    750,
    "A man arranging ceramics and linen on a wooden table for a styled photo shoot, with a camera on a stand above.",
  ),
  youtube: image(
    "youtube",
    560,
    750,
    "A woman adjusting a camera on a tripod beside a softbox light and a boom microphone in a home studio.",
  ),
  twitch: image(
    "twitch",
    560,
    750,
    "A young man wearing a headset at a streaming desk with two monitors, lit by a warm lamp.",
  ),
  x: image(
    "x",
    560,
    750,
    "A woman writing at a laptop at a cafe table, with a notebook and a cup of coffee beside her.",
  ),
  musicians: image(
    "musicians",
    800,
    993,
    "A singer-songwriter playing an acoustic guitar at a microphone in a small venue.",
  ),
  podcasters: image(
    "podcasters",
    800,
    800,
    "Two podcasters wearing headphones, talking into microphones across a wooden table.",
  ),
  artists: image(
    "artists",
    800,
    1071,
    "An artist painting at an easel in a studio, with brushes and canvases around her.",
  ),
  "small-business": image(
    "small-business",
    800,
    993,
    "A bakery owner smiling behind his counter, holding a tray of fresh loaves.",
  ),
  coaches: image(
    "coaches",
    800,
    800,
    "A coach and a client laughing together across a small table in a bright room.",
  ),
};
