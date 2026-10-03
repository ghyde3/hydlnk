import { NextResponse } from "next/server";
import { getOgPng } from "@/lib/publish/og-image";
import { ogImageUrl } from "@/lib/publish/urls";
import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import { getTenantPageState } from "../../../published-page";

export const dynamic = "force-dynamic";

/**
 * GET /og on a tenant host (M2-30): the page's 1200x630 social image, a PNG. Not found (404, never
 * stored) for a handle with nothing published, so the image never exists before the page does.
 * The bytes come from the page's cache tag, so Publish refreshes them with the page; autosave
 * never does. The page's metadata points here with `?v=<published_at ms>`: that exact URL never
 * changes content, so it may sit in a CDN for a day (no longer: a deleted account's image should not
 * outlive it by much, and nothing purges a CDN copy), and any other URL is cached briefly.
 */
export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const state = await getTenantPageState(handle);
  if (state.kind !== "published") {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const { page } = state;
  const png = await getOgPng({
    pageId: page.pageId,
    publishedAt: page.publishedAt,
    document: page.document,
    handle,
    host: `${handle}.${HANDLE_DISPLAY_DOMAIN}`,
  });

  const requested = new URL(request.url).searchParams.get("v");
  const current = new URL(ogImageUrl(handle, page.publishedAt)).searchParams.get("v");
  const versioned = requested !== null && requested === current;
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": versioned
        ? "public, max-age=300, s-maxage=300, immutable"
        : "public, max-age=300, s-maxage=300",
    },
  });
}
