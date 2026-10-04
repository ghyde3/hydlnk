import { plainNotFoundResponse } from "@/lib/tenant-render/respond";

/*
 * Tenant pages have no sub-paths: `/anything` and `/a/b/c` on a handle host are the plain tenant
 * 404 (a sub-path never offers to claim anything). The answer depends on nothing, so it is static
 * like the page itself. /og, /hl-query-count and the tracking routes are siblings or never get here.
 */
export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

export function GET() {
  return plainNotFoundResponse();
}
