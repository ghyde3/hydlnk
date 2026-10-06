/**
 * A finished HTML document as a response. The proxy adds the tenant security headers. Development
 * never stores a page (`next dev` renders every request), so it says so: `no-store`, as it did when
 * the pages were React pages. A production response carries no `Cache-Control` of its own here, so
 * Next.js writes the one that follows from the route's revalidate time (`s-maxage`, M2-26).
 */
export function htmlResponse(
  html: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(process.env.NODE_ENV === "production" ? {} : { "Cache-Control": "no-store" }),
      ...headers,
    },
  });
}
