import { NextResponse } from "next/server";
import { customOgImageUrl } from "@/lib/domains/urls";
import { clientEnv } from "@/lib/env/client";
import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import { getOgPng } from "@/lib/publish/og-image";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { lookupHandleByPageId } from "@/lib/domains/page-handle";
import { getTenantPageStateById } from "../../../published-page";

export const dynamic = "force-dynamic";

const notFound = () =>
  new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /og on a custom host (M4-09): the page's 1200x630 social image, the same PNG the handle host
 * serves (same inputs, so it shares the cache entry), reached as /sites/<pageId>/og after the proxy
 * has resolved the host. 404 (never stored) for anything that is not a published page. The page's
 * metadata points here with `?v=<published_at ms>`: that exact URL never changes content.
 */
export async function GET(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const state = await getTenantPageStateById(pageId);
  if (state.kind !== "published") return notFound();
  const handle = await lookupHandleByPageId(pageId);
  if (!handle) return notFound();

  const { page } = state;
  const png = await getOgPng({
    pageId: page.pageId,
    publishedAt: page.publishedAt,
    document: page.document,
    handle,
    host: `${handle}.${HANDLE_DISPLAY_DOMAIN}`,
  });

  // The versioned URL named in the page's metadata may sit in a CDN for a while; any other is brief.
  const requested = new URL(request.url).searchParams.get("v");
  const hostname = await getPrimaryDomain(pageId);
  const current = hostname
    ? new URL(
        customOgImageUrl(hostname, page.publishedAt, clientEnv.NEXT_PUBLIC_ROOT_DOMAIN),
      ).searchParams.get("v")
    : null;
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
