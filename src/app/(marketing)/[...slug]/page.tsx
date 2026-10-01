import { notFound } from "next/navigation";

/**
 * Catch-all for the root host: every path that is not a real page ends here, so unknown URLs get
 * the branded 404 instead of Next.js's default. The proxy also rewrites direct requests for the
 * internal prefixes (/app, /t, /sites) to a path that lands here.
 */
export default function UnknownMarketingPath(): never {
  notFound();
}
