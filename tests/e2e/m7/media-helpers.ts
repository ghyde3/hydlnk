import { expect, type BrowserContext, type Page } from "@playwright/test";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import {
  draftOf,
  publishDocOf,
  uploadImage,
  userWithDraft,
  type TestPage,
} from "../m2/blocks-helpers";
import { SERVER_PORT } from "../m2/publish-helpers";
import { emptyDraft, newBlockId, type Block, type ImageRef } from "@/lib/document";

/**
 * Shared setup of the M7-15 specs (media-pages.spec.ts, media-surfaces.spec.ts): one page that holds
 * one of every kind of uploaded image, a watcher for requests, /media responses and CSP violations,
 * and the checks every surface must pass.
 */

// The token schema only accepts a background image on this project's Storage origin.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= supabaseUrl();

/** User ids whose media folders the spec removes after it runs. */
export const owners: string[] = [];

export const STORAGE_ORIGIN = new URL(supabaseUrl()).origin;
/** The one canonical media origin: the root host. Every image loads from `${MEDIA}/media/...`. */
export const MEDIA = `http://localhost:${SERVER_PORT}`;
export const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

export interface Seed extends TestPage {
  photo: ImageRef;
  image: ImageRef;
  card: ImageRef;
  thumb: ImageRef;
  bg: ImageRef;
  /** The stored form of the background: the full Storage URL. */
  bgStored: string;
}

/** A signed-in user whose draft and published page both hold one of every kind of uploaded image. */
export async function seed(context: BrowserContext, label: string): Promise<Seed> {
  const user = await userWithDraft(context, label, (handle) => draftOf(handle, []));
  owners.push(user.userId);
  const [photo, image, card, thumb, bg] = await Promise.all([
    uploadImage(user.userId, 200, 200, [200, 60, 60]),
    uploadImage(user.userId, 600, 300, [60, 200, 60]),
    uploadImage(user.userId, 640, 320, [60, 60, 200]),
    uploadImage(user.userId, 80, 80, [200, 200, 60]),
    uploadImage(user.userId, 800, 600, [90, 90, 90]),
  ]);
  const bgStored = `${supabaseUrl()}/storage/v1/object/public/page-media/${bg.path}`;
  const blocks = [
    { id: newBlockId(), type: "header", visible: true, text: "Gallery" },
    {
      id: newBlockId(),
      type: "image",
      visible: true,
      image,
      alt: "A green picture",
      url: "",
    },
    {
      id: newBlockId(),
      type: "card",
      visible: true,
      title: "Blue card",
      caption: "With an image",
      url: "https://example.com/card",
      image: card,
    },
    {
      id: newBlockId(),
      type: "link",
      visible: true,
      label: "A link with a thumbnail",
      url: "https://example.com/link",
      icon: { type: "image", image: thumb },
    },
  ] as unknown as Block[];
  const tokens = { bgType: "image" as const, bgImage: bgStored, overlayOpacity: 0.3, blur: 0 };

  const base = emptyDraft(user.handle);
  const draft = {
    ...base,
    profile: { ...base.profile, name: "Media Test", photo },
    theme: { ref: null, overrides: tokens },
    blocks,
  };
  const published = publishDocOf(blocks, { name: "Media Test", photo, tokens });
  const { error } = await adminClient()
    .from("pages")
    .update({ draft, published, published_at: new Date().toISOString() })
    .eq("id", user.pageId);
  if (error) throw new Error(`seeding the page failed: ${error.message}`);
  return { ...user, photo, image, card, thumb, bg, bgStored };
}

/** Records every request the page makes, every /media response, and any CSP violation. */
export function watch(page: Page) {
  const requests: string[] = [];
  const media: { url: string; status: number; headers: Record<string, string> }[] = [];
  const violations: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/media/")) {
      media.push({
        url: response.url(),
        status: response.status(),
        headers: response.headers(),
      });
    }
  });
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  return { requests, media, violations };
}

/** Scrolls every image into view (they are lazy) and waits until each has decoded. */
export async function allLoaded(page: Page, scope: string): Promise<{ srcs: string[] }> {
  const images = page.locator(`${scope} img`);
  const count = await images.count();
  for (let i = 0; i < count; i += 1) await images.nth(i).scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        images.evaluateAll((els) =>
          els.every(
            (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
          ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  return { srcs: await images.evaluateAll((els) => els.map((el) => el.getAttribute("src") ?? "")) };
}

export const mediaPaths = (s: Seed) => [s.photo, s.image, s.card, s.thumb].map((ref) => ref.path);

/** What every surface must satisfy: /media images from the root origin that loaded, nothing from Storage. */
export function expectOwnAddresses(
  s: Seed,
  srcs: string[],
  w: ReturnType<typeof watch>,
  label: string,
  opts: { all?: boolean } = {},
): void {
  const own = srcs.filter((src) => src.includes(s.userId));
  for (const path of opts.all === false ? [] : mediaPaths(s)) {
    expect(own, `${label}: ${path}`).toContain(`${MEDIA}/media/${path}`);
  }
  for (const src of srcs) {
    expect(src, label).not.toContain("/storage/v1/");
    expect(src, label).not.toContain(STORAGE_ORIGIN);
    if (src.includes(s.userId))
      expect(src, label).toMatch(
        new RegExp(`^${MEDIA}/media/[0-9a-f-]{36}/[a-z0-9-]+\\.(png|webp|jpg)$`),
      );
  }
  expect(
    w.requests.filter((request) => request.startsWith(`${STORAGE_ORIGIN}/storage/`)),
    `${label}: requests to Storage`,
  ).toEqual([]);
  for (const response of w.media) {
    expect(response.status, response.url).toBe(200);
    expect(response.headers["cache-control"], response.url).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers["vercel-cdn-cache-control"], response.url).toBe(
      "public, max-age=604800",
    );
  }
  expect(w.violations, `${label}: CSP violations`).toEqual([]);
}
