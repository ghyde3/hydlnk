import { insertPage, makeUser, rand } from "../fixtures/data";
import { publishDocOf, uploadImage } from "../m2/blocks-helpers";
import { SERVER_PORT } from "../m2/publish-helpers";
import { newBlockId, type Block } from "@/lib/document";

/**
 * The fixture page of the M8 specs (M8-09 step 2): a Free or Pro page made with the secret-key
 * helpers and already published, with a real avatar and card image in the page-media bucket: a
 * profile photo, a name and a bio; a header; three links (one with a built-in icon); a text block with
 * bold, italic and a link; four social icons; a card with an image; a YouTube and a Spotify embed; a
 * divider; a Fraunces 700 heading over an Inter body.
 */

const PORT = SERVER_PORT;

export interface Seeded {
  handle: string;
  pageId: string;
  userId: string;
  url: string;
  linkBlockId: string;
}

export async function seedFullPage(
  plan: "free" | "pro",
  overrides: { name?: string; bio?: string; nameFont?: string } = {},
): Promise<Seeded> {
  const user = await makeUser(`m8-budget-${plan}`, { plan });
  const handle = `zq-m8-${plan}-${rand(5)}`;
  const [photo, card] = await Promise.all([
    uploadImage(user.id, 200, 200, [200, 60, 60]),
    uploadImage(user.id, 640, 320, [60, 60, 200]),
  ]);
  const text = "Photographer in Orlando. Bold words, italic words and a link to my work.";
  const link = (label: string, extra: object = {}) =>
    ({
      id: newBlockId(),
      type: "link",
      visible: true,
      label,
      url: `https://example.com/${rand(4)}`,
      ...extra,
    }) as unknown as Block;
  const linkBlockId = newBlockId();
  const blocks = [
    { id: newBlockId(), type: "header", visible: true, text: "Selected work" },
    {
      ...link("Book a portrait session"),
      id: linkBlockId,
      icon: { type: "builtin", name: "calendar" },
    },
    link("Latest gallery"),
    link("Prints and posters"),
    {
      id: newBlockId(),
      type: "text",
      visible: true,
      text,
      marks: [
        { type: "bold", start: 25, end: 35 },
        { type: "italic", start: 37, end: 49 },
        { type: "link", start: 56, end: 72, id: newBlockId(), url: "https://example.com/work" },
      ],
    },
    {
      id: newBlockId(),
      type: "social",
      visible: true,
      icons: ["instagram", "tiktok", "youtube", "x"].map((platform) => ({
        id: newBlockId(),
        platform,
        url: `https://example.com/${platform}`,
      })),
    },
    {
      id: newBlockId(),
      type: "card",
      visible: true,
      title: "Night Market",
      caption: "View the gallery",
      url: "https://example.com/night-market",
      image: card,
    },
    {
      id: newBlockId(),
      type: "embed",
      visible: true,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      caption: "Behind the lens",
    },
    {
      id: newBlockId(),
      type: "embed",
      visible: true,
      url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      caption: "Studio playlist",
    },
    { id: newBlockId(), type: "divider", visible: true },
  ] as unknown as Block[];
  const base = publishDocOf(blocks, {
    name: overrides.name ?? "Mara Okafor",
    bio: overrides.bio ?? "Portrait and studio photographer, Orlando FL",
    photo,
    tokens: { fontHeading: "Fraunces", fontBody: "Inter", weightHeading: 700 },
  });
  // M9-24: a name font in a third family (the variant of the budget); none by default.
  const doc = overrides.nameFont
    ? { ...base, profile: { ...base.profile, nameFont: overrides.nameFont } }
    : base;
  const pageId = await insertPage(user.id, handle, {
    published: doc,
    published_at: new Date().toISOString(),
  });
  return {
    handle,
    pageId,
    userId: user.id,
    url: `http://${handle}.localhost:${PORT}/`,
    linkBlockId,
  };
}
