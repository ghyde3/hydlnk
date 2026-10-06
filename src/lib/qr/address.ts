import { tenantOrigin } from "@/lib/editor/urls";

/**
 * The address the page's QR code encodes (M6-31): the page's public address and nothing else, with
 * no query string and no tracking parameter. `https://{hostname}/` for the page's primary domain
 * (the oldest verified custom domain, `getPrimaryDomain`'s rule, the same one that names og:url)
 * and otherwise the handle's address on the root domain, `http://mara.localhost:3000/` locally.
 * Decided on the server from the page's own rows and passed to the screen as a prop: no field or
 * query string of the editor can change it.
 */
export function publicPageAddress(input: {
  handle: string;
  primaryDomain: string | null;
  rootDomain: string;
}): string {
  if (input.primaryDomain) return `https://${input.primaryDomain}/`;
  return `${tenantOrigin(input.handle, input.rootDomain)}/`;
}
