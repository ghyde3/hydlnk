import { plainNotFoundResponse } from "@/lib/tenant-render/respond";

/** Custom-domain pages have no sub-paths yet: /sites/<pageId>/anything is the plain tenant 404. */
export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

export function GET() {
  return plainNotFoundResponse();
}
