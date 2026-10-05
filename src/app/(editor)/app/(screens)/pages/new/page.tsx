import type { Metadata } from "next";
import Link from "next/link";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { NewPageForm } from "@/components/pages/new-page-form";
import { PLAN_LIMITS, pageLimitMessage } from "@/lib/limits";
import { getAppContext } from "@/lib/pages/context";

export const metadata: Metadata = { title: "New site" };

/**
 * New site (M4-18, M11-11, Signup.dc.html): another hydlnk.com address for the same account, inside the app
 * shell. Shows the usage line ("You’ve used 1 of 3 sites") and the handle form; at the plan's page
 * limit it shows that plan's message and a link to the plans instead of a form that would only be
 * refused. The server-only create (POST /api/pages, then the database trigger) is the enforcement.
 */
export default async function NewPageScreen() {
  const { plan, pages } = await getAppContext();
  const limit = PLAN_LIMITS[plan].pages;
  const atLimit = pages.length >= limit;

  return (
    <>
      <ScreenHeader breadcrumb="Sites" title="New site" />
      <ScreenBody maxWidth="max-w-[560px]">
        <Card className="flex flex-col gap-4">
          <p data-usage className="text-sm text-text-2">
            You’ve used {pages.length} of {limit} sites
          </p>
          {atLimit ? (
            <div className="flex flex-col items-start gap-2">
              <p role="status" className="text-sm leading-relaxed text-ink">
                {pageLimitMessage(plan, pages.length)}
              </p>
              <Link
                href="/settings#plans"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline hl:w-auto"
              >
                See plans
              </Link>
            </div>
          ) : (
            <NewPageForm />
          )}
        </Card>
      </ScreenBody>
    </>
  );
}
