import { readActiveAnnouncement } from "@/lib/announcements/read";
import { AnnouncementBannerView } from "./announcement-banner-view";

/**
 * The announcement at the top of every signed-in editor screen (M13-09), above the screen header. It
 * is drawn only by the app shell (`AppShellFrame`), so it never reaches a public page, the marketing
 * site, the share preview or the admin screens. The row comes from `readActiveAnnouncement`, which only
 * returns one between its start and end.
 */
export async function AnnouncementBanner() {
  const announcement = await readActiveAnnouncement();
  if (!announcement) return null;
  return <AnnouncementBannerView announcement={announcement} />;
}
