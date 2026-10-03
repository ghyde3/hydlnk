/**
 * Absolute URLs on the HYDLNK hosts, built from NEXT_PUBLIC_ROOT_DOMAIN.
 * Plain http for local development ("localhost:3000", "*.localhost"), https everywhere else.
 */

function hostnameOf(rootDomain: string): string {
  return rootDomain.split(":")[0] ?? rootDomain;
}

export function protocolFor(rootDomain: string): "http" | "https" {
  const hostname = hostnameOf(rootDomain);
  return hostname === "localhost" || hostname.endsWith(".localhost") ? "http" : "https";
}

/** http://localhost:3000 or https://hydlnk.com */
export function rootOrigin(rootDomain: string): string {
  return `${protocolFor(rootDomain)}://${rootDomain}`;
}

/** http://app.localhost:3000 or https://app.hydlnk.com */
export function appOrigin(rootDomain: string): string {
  return `${protocolFor(rootDomain)}://app.${rootDomain}`;
}

/**
 * The public origin of a custom domain: `https://links.example.com` in production, and
 * `http://links.example.test:3000` locally (same scheme and port as the local root domain, so the
 * address in a page's og:url can be opened in a development browser that maps the name to
 * 127.0.0.1). Built from the stored hostname and the configured root domain, never from a request.
 */
export function customOrigin(hostname: string, rootDomain: string): string {
  if (protocolFor(rootDomain) === "https") return `https://${hostname}`;
  const port = rootDomain.split(":")[1];
  return `http://${hostname}${port ? `:${port}` : ""}`;
}
