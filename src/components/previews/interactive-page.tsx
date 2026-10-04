"use client";

import { EmbedFacade } from "@/components/page/embed-facade";
import { provideEmbedFacade } from "@/components/page/embed-slot";
import { PageRenderer, type PageRendererProps } from "@/components/page/page-renderer";

// The owner's full-size Preview page (/preview/{pageId}) is a server page, and a server page draws
// `PageRenderer` with the plain facade markup, which only the live page's script can upgrade. A
// preview has no such script, so this client wrapper draws the same renderer in the browser with the
// React facade, which mounts the same iframe on a tap (M6-27, M8-05).
provideEmbedFacade(EmbedFacade);

export function InteractivePageRenderer(props: PageRendererProps) {
  return <PageRenderer {...props} />;
}
