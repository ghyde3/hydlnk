"use client";

import { createContext, useContext } from "react";

/**
 * The site an upload is for (Wave F, A31): the workspace and the post editor provide their site's
 * id, and every sender of POST /api/media names it (`uploadSiteHeaders`), so the server stores the file
 * in that site OWNER's folder, after the access helper said the user may edit the site.
 */
export const UploadSiteContext = createContext<string | null>(null);

export function useUploadSite(): string | null {
  return useContext(UploadSiteContext);
}
