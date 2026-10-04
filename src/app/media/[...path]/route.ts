import { methodNotAllowed, serveMedia } from "@/lib/media/serve";

export const dynamic = "force-dynamic";

/*
 * Uploaded images from the page's own address (M7-14): GET /media/{uid}/{file}.{jpg|png|webp} on
 * the root host only (one CDN cache key per image; every other host gets the short 404). The proxy never runs for these paths (the matcher skips static extensions outside
 * /app, /t, /sites and /r), so there is no host rewrite, no session and no tenant header: the
 * route answers the same everywhere, sets no cookie and reads none. The CDN caches the answer; the
 * rules, the headers and the refusals are in src/lib/media/serve.ts.
 */
type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return serveMedia(request, { segments: (await params).path });
}

/** The same status and headers as GET with no body (the upstream is asked with HEAD too). */
export async function HEAD(request: Request, { params }: Context) {
  return serveMedia(request, { segments: (await params).path });
}

const refuse = () => methodNotAllowed();
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;

/** Say what is allowed. */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: "GET, HEAD" } });
}
