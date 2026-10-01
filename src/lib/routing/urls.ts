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
