import type { ProfileOptions } from "@/lib/document";

/** The parts of the page a show switch has turned off, in the order photo, name, bio (M7-03). */
export function hiddenParts(
  options: Pick<ProfileOptions, "showPhoto" | "showName" | "showBio">,
): string[] {
  const parts: string[] = [];
  if (!options.showPhoto) parts.push("photo");
  if (!options.showName) parts.push("name");
  if (!options.showBio) parts.push("bio");
  return parts;
}
