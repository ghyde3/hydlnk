import type { DraftDoc } from "@/lib/document";

/**
 * A rich draft for the "untouched means untouched" checks (M10-23): every page-level setting no tool
 * can change (banner, share card, UTM tags, redirect mode, name style), a link with a lock, its own
 * UTM tags and block style, a text block with marks and an alignment, and several other block types.
 * Passes `draftDocSchema`.
 */
export function richDraft(handle: string, userId: string, rev = 3): DraftDoc {
  const photo = { path: `${userId}/photo0000001.webp`, width: 600, height: 600 };
  return {
    version: 1,
    rev,
    profile: {
      name: "Mara Okafor",
      bio: "Ceramics and slow mornings.",
      photo,
      photoShape: "square",
      photoSize: "large",
      photoBorder: "thin",
      showPhoto: true,
      showName: true,
      showBio: false,
      nameSize: "large",
    },
    share: { title: "Mara on HYDLNK", description: "Studio notes and shop.", image: null },
    banner: {
      id: "banner-id-001",
      visible: true,
      text: "Studio sale on",
      label: "Shop",
      url: "https://example.com/sale",
    },
    utm: { source: "bio", medium: "link" },
    redirect: { linkId: "link-id-001" },
    theme: { ref: null, overrides: { accent: "#112233", radius: 6 } },
    blocks: [
      {
        id: "link-id-001",
        type: "link",
        visible: true,
        label: "Shop",
        url: "https://example.com/shop",
        featured: "bold",
        utm: { source: "shop", off: false },
        lock: { kind: "age" },
        overrides: { radius: 4, accent: "#445566" },
      },
      {
        id: "text-id-001",
        type: "text",
        visible: true,
        text: "Hello world, welcome in",
        marks: [
          { type: "bold", start: 0, end: 5 },
          { type: "link", id: "mark-id-001", start: 6, end: 11, url: "https://example.com/world" },
          { type: "align", start: 0, end: 23, align: "center" },
        ],
      },
      {
        id: "card-id-0001",
        type: "card",
        visible: true,
        title: "New glaze",
        caption: "Out now",
        url: "https://example.com/glaze",
        image: {
          path: `${userId}/glaze000001.webp`,
          width: 800,
          height: 400,
          focus: { x: 0.3, y: 0.6 },
        },
      },
      {
        id: "social-id-01",
        type: "social",
        visible: true,
        icons: [
          { id: "icon-id-0001", platform: "github", url: "https://github.com/mara" },
          { id: "icon-id-0002", platform: "email", address: "mara@example.com" },
        ],
      },
      {
        id: "faq-id-00001",
        type: "faq",
        visible: false,
        items: [{ id: "faq-item-001", question: "Do you ship?", answer: "Yes, worldwide." }],
      },
      {
        id: "map-id-00001",
        type: "map",
        visible: true,
        name: "Studio",
        address: "1 Kiln Lane",
        googleId: "map-google-01",
        appleId: "map-apple-001",
      },
    ],
  } as unknown as DraftDoc;
}
