import { notFound } from "next/navigation";

/**
 * Custom-domain pages: the proxy rewrites a verified custom host here as /sites/<pageId>.
 * TODO(M4): validate the id, load the published page and render it like /t/[handle] does.
 * Until the domains lookup exists nothing is routed here but the "unknown host" fallback.
 */
export default function SitePage(): never {
  notFound();
}
