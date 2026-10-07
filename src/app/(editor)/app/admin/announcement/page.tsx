import { AnnouncementForm } from "@/components/admin/announcement-form";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { readCurrentAnnouncements } from "@/lib/admin/announcement-queries";

export const metadata = { title: "Announcement" };
export const dynamic = "force-dynamic";

/**
 * /admin/announcement (M13-09): the one message at the top of the editor for every signed-in owner,
 * between a start and an end. Never on public pages, the marketing site or a share preview. A
 * non-admin gets the app's 404 from `requireAdmin`; every change is guarded again on the server
 * (`set_announcement` and `clear_announcement`, both audited).
 */
export default async function AdminAnnouncement() {
  await requireAdmin();
  const current = await readCurrentAnnouncements();
  return (
    <>
      <ScreenHeader breadcrumb="admin / announcement" title="Announcement" />
      <ScreenBody maxWidth="max-w-[760px]">
        <p className="text-sm leading-relaxed text-text-2">
          One short message at the top of the editor for everyone who is signed in. People can
          dismiss it in their browser. Setting a new one replaces the current one.
        </p>
        <AnnouncementForm current={current} />
      </ScreenBody>
    </>
  );
}
