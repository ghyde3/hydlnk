import type { Metadata } from "next";
import { DeleteAccountDialog } from "@/components/app/delete-account-dialog";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { signOut } from "@/lib/auth/actions";
import { getAppContext } from "@/lib/pages/context";
import { PRODUCT_DOMAIN, handleAddress } from "@/lib/pages/plans";

export const metadata: Metadata = { title: "Settings & billing" };

const FIELD_LABEL = "text-[13px] font-semibold text-ink-2";
const FIELD_VALUE =
  "m-0 flex min-h-11 items-center rounded-md border border-line-3 bg-surface px-3 text-sm break-all";

/**
 * Settings & billing. Milestone 1 holds the Account card only: the session user's email and the
 * current page's handle (read-only; changing either is not in the v1 scope), Sign out and Delete
 * account. The plan band, usage meters and plan cards land above it in Milestone 4.
 */
export default async function SettingsScreen() {
  const { user, pages, current } = await getAppContext();

  return (
    <>
      <ScreenHeader breadcrumb="Account" title="Settings & billing" />
      <ScreenBody maxWidth="max-w-[920px]">
        <Card className="flex flex-col gap-3.5">
          <h2 className="text-sm font-semibold">Account</h2>
          <dl className="flex flex-wrap gap-3">
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
              <dt className={FIELD_LABEL}>Email</dt>
              <dd className={FIELD_VALUE}>{user.email}</dd>
            </div>
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
              <dt className={FIELD_LABEL}>Handle</dt>
              <dd className={`${FIELD_VALUE} font-mono`}>
                <span>
                  {current.handle}
                  <span className="text-text-3">.{PRODUCT_DOMAIN}</span>
                </span>
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 border-t border-line pt-3.5 hl:flex-row hl:items-center hl:justify-between">
            <form action={signOut} className="contents">
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink hl:w-auto"
              >
                Sign out
              </button>
            </form>
            <DeleteAccountDialog
              handle={current.handle}
              addresses={pages.map((page) => handleAddress(page.handle))}
            />
          </div>
        </Card>
      </ScreenBody>
    </>
  );
}
