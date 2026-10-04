import type { Metadata } from "next";
import { escapeHtml } from "./escape";

/**
 * The `<head>` of a live tenant document (M8-02): the same tags the page had when Next.js wrote
 * them from `generateMetadata`, written by one small serializer that escapes every value.
 *
 *   charset and viewport      the two tags every page has always had
 *   <title>, description      `pageMetadata` (src/lib/publish/share-meta.ts) for a published page
 *   og:*, twitter:*           the same function: it stays the one place both hosts get them from
 *   robots                    `noindex` for the placeholder, every 404 and the error page
 *   the favicon link          `/icon.svg`, the app's own icon (src/app/icon.svg)
 *   preloads                  the theme fonts (latin faces) and the avatar picture
 *   <style>                   the page's one inline stylesheet, already minified by the caller
 *
 * The serializer accepts the small set of `Metadata` fields those functions return and throws on
 * anything else, so a field added to `pageMetadata` cannot be dropped from the page unnoticed.
 */

export type HeadPreload =
  | { as: "font"; href: string; type: "font/woff2" }
  | { as: "image"; href: string };

export interface HeadInput {
  metadata: Metadata;
  /** The text of the one `<style>` element. Generated from files and allowlists, never from tenant text. */
  css: string;
  preloads?: readonly HeadPreload[];
  /** Whole `<link rel="preload" as="image">` tags React's renderer wrote ahead of the body (see live-page.tsx). */
  hints?: readonly string[];
}

const FAVICON = '<link rel="icon" href="/icon.svg" sizes="any" type="image/svg+xml">';

function meta(attribute: "name" | "property", key: string, value: string | number | undefined) {
  if (value === undefined || value === "") return "";
  return `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(String(value))}">`;
}

function only(object: object, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new Error(`Unsupported ${where} field "${key}" in the head`);
  }
}

type ImageDescriptor = { url: string | URL; width?: string | number; height?: string | number; alt?: string };

function images(list: unknown): ImageDescriptor[] {
  if (list === undefined) return [];
  const items = Array.isArray(list) ? list : [list];
  return items.map((item) => {
    if (typeof item === "string") return { url: item };
    if (item && typeof item === "object" && "url" in item) {
      only(item, ["url", "width", "height", "alt"], "image");
      return item as ImageDescriptor;
    }
    throw new Error("Unsupported image descriptor in the head");
  });
}

function openGraph(og: NonNullable<Metadata["openGraph"]>): string {
  only(og, ["type", "title", "description", "url", "images"], "openGraph");
  const record = og as { type?: string; title?: unknown; description?: unknown; url?: unknown };
  let out = "";
  out += meta("property", "og:title", record.title as string | undefined);
  out += meta("property", "og:description", record.description as string | undefined);
  out += meta("property", "og:url", record.url === undefined ? undefined : String(record.url));
  for (const image of images((og as { images?: unknown }).images)) {
    out += meta("property", "og:image", String(image.url));
    out += meta("property", "og:image:width", image.width);
    out += meta("property", "og:image:height", image.height);
    out += meta("property", "og:image:alt", image.alt);
  }
  out += meta("property", "og:type", record.type);
  return out;
}

function twitter(card: NonNullable<Metadata["twitter"]>): string {
  only(card, ["card", "title", "description", "images"], "twitter");
  const record = card as { card?: string; title?: unknown; description?: unknown };
  let out = "";
  out += meta("name", "twitter:card", record.card);
  out += meta("name", "twitter:title", record.title as string | undefined);
  out += meta("name", "twitter:description", record.description as string | undefined);
  for (const image of images((card as { images?: unknown }).images)) {
    out += meta("name", "twitter:image", String(image.url));
  }
  return out;
}

/** The title, description, robots, Open Graph and Twitter tags of a `Metadata` object. */
export function metadataTags(metadata: Metadata): string {
  only(metadata, ["title", "description", "robots", "openGraph", "twitter"], "metadata");
  if (typeof metadata.title !== "string") throw new Error("The head needs a string title");
  let out = `<title>${escapeHtml(metadata.title)}</title>`;
  out += meta("name", "description", metadata.description ?? undefined);
  if (metadata.robots !== undefined) {
    const robots = metadata.robots;
    if (typeof robots !== "object" || robots === null || Object.keys(robots).join() !== "index") {
      throw new Error("Unsupported robots value in the head");
    }
    if ((robots as { index?: boolean }).index === false) out += meta("name", "robots", "noindex");
  }
  if (metadata.openGraph) out += openGraph(metadata.openGraph);
  if (metadata.twitter) out += twitter(metadata.twitter);
  return out;
}

function preloadTag(preload: HeadPreload): string {
  if (preload.as === "font") {
    return `<link rel="preload" as="font" href="${escapeHtml(preload.href)}" type="${preload.type}" crossorigin>`;
  }
  return `<link rel="preload" as="image" href="${escapeHtml(preload.href)}" referrerpolicy="no-referrer">`;
}

/** The text of a `<style>` element must never be able to close it. */
function safeStyleText(css: string): string {
  if (/<\/style|<!--|<script/i.test(css)) throw new Error("The inline stylesheet holds markup");
  return css;
}

/** Everything inside `<head>`. */
export function renderHead({ metadata, css, preloads = [], hints = [] }: HeadInput): string {
  return (
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    metadataTags(metadata) +
    FAVICON +
    preloads.map(preloadTag).join("") +
    hints.join("") +
    `<style>${safeStyleText(css)}</style>`
  );
}

/** One finished HTML document. `body` is markup the caller rendered (and already escaped). */
export function renderDocument(head: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}
