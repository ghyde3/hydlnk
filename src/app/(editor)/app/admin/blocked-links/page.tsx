import Link from "next/link";
import { BlockedLinksManager } from "@/components/admin/blocked-links-manager";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import {
  BLOCKED_PAGE_SIZE,
  listBlockedDomains,
  parseBlockedPage,
} from "@/lib/blocklist/admin-queries";

export const metadata = { title: "Blocked links" };
export const dynamic = "force-dynamic";

const PAGER =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline";

/**
 * /admin/blocked-links (M7-13): the domains nobody can save or publish a link to, with a form to add
 * one (and a reason) and a Remove on every row. Adding shows how many live pages already link to the
 * domain; nothing is unpublished. A non-admin gets the app's 404 from `requireAdmin`, and every
 * change is guarded again on the server (`block_domain` and `unblock_domain`, both audited).
 */
export default async function AdminBlockedLinks({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const page = parseBlockedPage(params.page);
  const { rows, hasMore } = await listBlockedDomains(page);
  const link = (target: number) =>
    target > 1 ? `/admin/blocked-links?page=${target}` : "/admin/blocked-links";

  return (
    <>
      <ScreenHeader breadcrumb="admin / blocked links" title="Blocked links" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <p className="text-sm leading-relaxed text-text-2">
          People can’t save or publish a link to these domains or their subdomains. Pages that are
          already live keep serving.
        </p>
        <BlockedLinksManager rows={rows} />
        {page > 1 || hasMore ? (
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs text-text-2">
              Page {page}, {BLOCKED_PAGE_SIZE} a page
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={link(page - 1)} className={PAGER}>
                  Previous
                </Link>
              ) : null}
              {hasMore ? (
                <Link href={link(page + 1)} className={PAGER}>
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </ScreenBody>
    </>
  );
}
