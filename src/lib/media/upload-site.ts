/**
 * The site an upload is for (Wave F, A31): every sender of POST /api/media (and of the cleanup call)
 * names it in this request header, so the server stores the file in that site OWNER's folder after
 * the access helper said the user may edit the site. The upload address itself stays the constant
 * "/api/media" (M6-20). No header (an old bundle): the user's own folder. Safe in client code.
 */
export const UPLOAD_SITE_HEADER = "x-hl-site";

export function uploadSiteHeaders(site: string | null): Record<string, string> {
  return site ? { [UPLOAD_SITE_HEADER]: site } : {};
}
