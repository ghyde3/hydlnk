/**
 * The site an upload is for (Wave F, A31): every sender of POST /api/media (and of the cleanup call)
 * names it in this request header, so the server stores the file in that site OWNER's folder after
 * the access helper said the user may edit the site. The upload address itself stays the constant
 * "/api/media" (M6-20). No header (an old bundle): the upload is refused with
 * UPLOAD_SITE_REQUIRED_MESSAGE (G22); the cleanup call without one works off the user's own queue.
 * Safe in client code.
 */
export const UPLOAD_SITE_HEADER = "x-hl-site";

/** The answer to an upload that names no site (an editor tab opened before Wave F). */
export const UPLOAD_SITE_REQUIRED_MESSAGE = "The editor was updated. Reload the page, then add the image again.";

export function uploadSiteHeaders(site: string | null): Record<string, string> {
  return site ? { [UPLOAD_SITE_HEADER]: site } : {};
}
