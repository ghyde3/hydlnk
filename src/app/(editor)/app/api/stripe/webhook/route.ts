import { NextResponse, type NextRequest } from "next/server";
import { processWebhook } from "@/lib/billing/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook on the app host only (M4-03). The proxy rewrites tenant, custom and
 * marketing hosts away from this file, so a signed request to any other host is a 404 that never
 * reaches the signature check. GET, PUT, PATCH and DELETE are not exported, so Next answers 405.
 *
 * The body is read as text, exactly as sent: Stripe signs the raw bytes, and a re-serialised JSON
 * body (different whitespace) does not verify. All the work, the verification included, is
 * `processWebhook`.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const result = await processWebhook(rawBody, request.headers.get("stripe-signature"));
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
