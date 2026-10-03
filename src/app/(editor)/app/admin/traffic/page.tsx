import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";

export const metadata = { title: "Traffic" };
export const dynamic = "force-dynamic";

/**
 * /admin/traffic: the review list for the high-traffic flag job (M5-10). The section exists now so
 * the admin shell has its three sections; the list replaces this empty state when M5-10 lands.
 */
export default async function AdminTraffic() {
  await requireAdmin();
  return (
    <>
      <ScreenHeader breadcrumb="admin / traffic" title="Traffic" />
      <ScreenBody>
        <Card>
          <p className="text-[15px] leading-relaxed text-text-2">No high-traffic pages flagged.</p>
        </Card>
      </ScreenBody>
    </>
  );
}
