import { beaconEndpoint } from "@/lib/analytics/ingest/routes";

export const dynamic = "force-dynamic";

/*
 * The view beacon (M4-21): POST /api/e with {pageId, referrer}, sent by the public page itself to a
 * relative URL, so the request goes to whichever host served the page: the proxy leaves this path
 * unrewritten on tenant and custom hosts. Every method is counted by the rate limiter; only POST
 * records. Everything lives in src/lib/analytics/ingest/beacon.ts.
 */
export async function POST(request: Request) {
  return beaconEndpoint(request);
}
export async function GET(request: Request) {
  return beaconEndpoint(request);
}
export async function HEAD(request: Request) {
  return beaconEndpoint(request);
}
export async function PUT(request: Request) {
  return beaconEndpoint(request);
}
export async function PATCH(request: Request) {
  return beaconEndpoint(request);
}
export async function DELETE(request: Request) {
  return beaconEndpoint(request);
}
