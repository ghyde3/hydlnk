import { CopyLinkButton } from "@/components/admin/copy-link-button";
import { DomainsHelpList } from "@/components/admin/domains-help-list";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { registrarGuideLinks } from "@/lib/admin/domains-help";
import { readDomainsNeedingHelp } from "@/lib/admin/overview-queries";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

export const metadata = { title: "Domains" };
export const dynamic = "force-dynamic";

/**
 * /admin/domains (M13-04): custom domains that are unverified after 24 hours or whose last check
 * failed, with the owner, the age and the last check's result. Re-check now runs the cron's own
 * verification for one domain. The registrar guides are listed once, each with a copy button, to
 * paste into a reply; the registrar is not detected.
 */
export default async function AdminDomains() {
  await requireAdmin();
  const domains = await readDomainsNeedingHelp().catch(() => null);
  const guides = registrarGuideLinks(rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN));
  return (
    <>
      <ScreenHeader breadcrumb="admin / domains" title="Domains" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <p className="text-sm leading-relaxed text-text-2">
          Custom domains that are still unverified after 24 hours, or whose last check failed. A
          domain that stays pending for 7 days is released automatically.
        </p>
        {domains === null ? (
          <Card>
            <p role="alert" className="text-[15px] leading-relaxed text-bad">
              The domains couldn’t be read right now. Reload to try again.
            </p>
          </Card>
        ) : domains.length === 0 ? (
          <Card>
            <p className="text-[15px] leading-relaxed text-text-2">
              No domain needs help right now.
            </p>
          </Card>
        ) : (
          <DomainsHelpList domains={domains} />
        )}
        <Card>
          <h2 className="text-base font-bold">Registrar guides</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-2">
            Copy the one that matches where the owner bought the domain.
          </p>
          <ul className="mt-3 flex flex-col">
            {guides.map((guide) => (
              <li
                key={guide.url}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-track py-1.5 first:border-t-0"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">{guide.label}</span>
                  <span className="font-mono text-xs text-text-2 [overflow-wrap:anywhere] select-all">
                    {guide.url}
                  </span>
                </div>
                <CopyLinkButton url={guide.url} label={guide.label} />
              </li>
            ))}
          </ul>
        </Card>
      </ScreenBody>
    </>
  );
}
