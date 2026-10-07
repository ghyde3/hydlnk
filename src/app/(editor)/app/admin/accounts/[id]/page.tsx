import { notFound } from "next/navigation";
import { SuspendAccountButton, UnsuspendButton } from "@/components/admin/admin-buttons";
import { AuditTable } from "@/components/admin/audit-table";
import { StateChip } from "@/components/admin/chips";
import { formatWhen } from "@/components/admin/format";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { getAccountDetail } from "@/lib/admin/account-queries";
import {
  SITE_BYTES_CAP,
  formatDate,
  stripeCustomerUrl,
  type AccountDetail,
} from "@/lib/admin/account-view";
import { requireAdmin } from "@/lib/admin/auth";
import { serverEnv } from "@/lib/env/server";
import { PLAN_IDS, PLAN_LIMITS, formatBytes, formatLimitBytes, type PlanId } from "@/lib/limits";
import { tenantOrigin } from "@/lib/publish/urls";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline";
const H2 = "text-base font-bold";
const DT = "font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase";
const DD = "text-sm [overflow-wrap:anywhere]";

const planName = (plan: string): string =>
  plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : "";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={DT}>{label}</dt>
      <dd className={DD}>{children}</dd>
    </div>
  );
}

function planLimit(plan: string): number {
  return PLAN_LIMITS[(PLAN_IDS as readonly string[]).includes(plan) ? (plan as PlanId) : "free"]
    .uploadBytes;
}

/**
 * /admin/accounts/{id} (M13-02), opened from a row of Pages search: one account's email, plan (and a
 * gift), sign-up and last sign-in, suspension, its sites with their pages and domains, storage,
 * connected apps, reports and audit history, with the buttons to suspend or unsuspend, open the live
 * site, open the customer in Stripe, gift a plan and see a draft. Admins only (`requireAdmin`); an id
 * with no account is the app's 404.
 */
export default async function AdminAccount({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const account: AccountDetail | null = await getAccountDetail(id);
  if (!account) notFound();

  const suspended = account.suspendedAt !== null;
  const stripeUrl = stripeCustomerUrl(account.stripeCustomerId, serverEnv.STRIPE_SECRET_KEY);
  const liveSite = account.sites.find((site) => site.published);
  const label = account.sites[0]?.handle ?? account.email;

  return (
    <>
      <ScreenHeader breadcrumb="admin / pages / account" title={account.email || account.id} />
      <ScreenBody maxWidth="max-w-[1000px]">
        <Card className="flex flex-col gap-4">
          <dl className="grid gap-3 hl:grid-cols-2">
            <Fact label="Email">{account.email || "—"}</Fact>
            <Fact label="Account id">
              <span className="font-mono text-[13px]">{account.id}</span>
            </Fact>
            <Fact label="Plan">
              <span data-plan={account.plan}>{planName(account.plan)}</span>
              {account.paidPlan !== account.plan ? (
                <span className="text-text-2"> (paid plan: {planName(account.paidPlan)})</span>
              ) : null}
            </Fact>
            <Fact label="Gift">
              {account.giftPlan ? (
                <span data-gift={account.giftActive ? "active" : "ended"}>
                  {planName(account.giftPlan)},{" "}
                  {account.giftUntil
                    ? `${account.giftActive ? "ends" : "ended"} ${formatDate(account.giftUntil)}`
                    : "no end date"}
                  {account.giftReason ? `. ${account.giftReason}` : ""}
                </span>
              ) : (
                "None"
              )}
            </Fact>
            <Fact label="Signed up">{formatDate(account.signedUpAt) || "—"}</Fact>
            <Fact label="Last sign-in">
              {account.lastSignInAt ? formatWhen(account.lastSignInAt) : "Never"}
            </Fact>
            <Fact label="State">
              <StateChip state={suspended ? "suspended" : liveSite ? "live" : "unpublished"} />
              {suspended ? (
                <span className="ml-2 text-text-2">since {formatDate(account.suspendedAt)}</span>
              ) : null}
            </Fact>
            <Fact label="Stripe customer">
              <span className="font-mono text-[13px]">{account.stripeCustomerId ?? "None"}</span>
            </Fact>
          </dl>
          <div className="flex flex-col gap-2 hl:flex-row hl:flex-wrap">
            {suspended ? (
              <UnsuspendButton accountId={account.id} handle={label} />
            ) : (
              <SuspendAccountButton
                accountId={account.id}
                handle={label}
                pageCount={account.sites.length}
              />
            )}
            {liveSite ? (
              <a
                href={`${tenantOrigin(liveSite.handle)}/`}
                target="_blank"
                rel="noopener noreferrer"
                className={BUTTON}
              >
                Open live site
              </a>
            ) : null}
            {stripeUrl ? (
              <a href={stripeUrl} target="_blank" rel="noopener noreferrer" className={BUTTON}>
                Open in Stripe
              </a>
            ) : null}
            <a href={`/admin/accounts/${account.id}/gift`} className={BUTTON}>
              Gift a plan
            </a>
          </div>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className={H2}>Sites</h2>
          {account.sites.length === 0 ? (
            <p className="text-sm text-text-2">This account has no sites.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {account.sites.map((site) => (
                <li
                  key={site.pageId}
                  data-site={site.handle}
                  className="flex flex-col gap-2 border-b border-track pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-col gap-2 hl:flex-row hl:items-center hl:justify-between">
                    <p className="font-mono text-[13px] [overflow-wrap:anywhere]">
                      {site.handle}{" "}
                      <StateChip
                        state={suspended ? "suspended" : site.published ? "live" : "unpublished"}
                      />
                    </p>
                    <a
                      href={`/admin-draft/${site.pageId}`}
                      aria-label={`See draft of ${site.handle}`}
                      className={BUTTON}
                    >
                      See draft
                    </a>
                  </div>
                  <ul className="flex flex-col gap-1 text-sm">
                    <li className="text-text-2">Home</li>
                    {site.subPages.map((sub) => (
                      <li key={sub.id} className="[overflow-wrap:anywhere]">
                        {sub.title}{" "}
                        <span className="font-mono text-xs text-text-2">/{sub.path}</span>{" "}
                        <span className="text-text-2">{sub.live ? "Live" : "Draft"}</span>
                      </li>
                    ))}
                  </ul>
                  {site.domains.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-sm">
                      {site.domains.map((domain) => (
                        <li key={domain.id} className="[overflow-wrap:anywhere]">
                          <span className="font-mono text-[13px]">{domain.hostname}</span>{" "}
                          <span className="text-text-2">{domain.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className={H2}>Storage</h2>
          <dl className="grid gap-3 hl:grid-cols-2">
            <Fact label="Uploads">
              <span data-uploads="">
                {formatBytes(account.uploadBytes)} of {formatLimitBytes(planLimit(account.plan))}
              </span>
            </Fact>
            <Fact label="Sub-pages">
              <span data-site-bytes="">
                {formatBytes(account.siteBytes)} of {formatLimitBytes(SITE_BYTES_CAP)}
              </span>
            </Fact>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className={H2}>Connected AI apps</h2>
          {account.apps.length === 0 ? (
            <p className="text-sm text-text-2">No apps are connected.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {account.apps.map((app) => (
                <li key={app.grantId} className="[overflow-wrap:anywhere]">
                  <span className="font-semibold">{app.clientName}</span>{" "}
                  <span className="text-text-2">
                    connected {formatDate(app.authorizedAt)}
                    {app.lastUsedAt ? `, last used ${formatDate(app.lastUsedAt)}` : ", never used"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className={H2}>Reports</h2>
          <p className="text-sm text-text-2">
            {account.reportsTotal} in all, {account.reportsOpen} open.
          </p>
          {account.reports.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {account.reports.map((report) => (
                <li key={report.id} className="[overflow-wrap:anywhere]">
                  {formatDate(report.createdAt)}, {report.reason}
                  {report.handle ? ` on ${report.handle}` : ""}{" "}
                  <span className="text-text-2">{report.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <section className="flex flex-col gap-3" aria-labelledby="account-audit">
          <div className="flex flex-col gap-2 hl:flex-row hl:items-center hl:justify-between">
            <h2 id="account-audit" className={H2}>
              Audit history
            </h2>
            <a href={`/admin/audit?account=${account.id}`} className={BUTTON}>
              Open in the audit log
            </a>
          </div>
          {account.audit.length === 0 ? (
            <Card>
              <p className="text-sm text-text-2">Nothing has been logged for this account.</p>
            </Card>
          ) : (
            <AuditTable rows={account.audit} showAccount={false} />
          )}
        </section>
      </ScreenBody>
    </>
  );
}
