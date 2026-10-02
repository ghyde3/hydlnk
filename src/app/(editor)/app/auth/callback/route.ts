import { handleAuthCallback } from "@/lib/auth/callback";

// Reads cookies and the query string: never cached.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAuthCallback(request);
}
