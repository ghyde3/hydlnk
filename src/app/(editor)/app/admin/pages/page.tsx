import Link from "next/link";
import { PagesTable } from "@/components/admin/pages-table";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { searchPages } from "@/lib/admin/queries";
import { ADMIN_PAGE_SIZE, cleanSearch } from "@/lib/admin/view";

export const metadata = { title: "Pages" };
export const dynamic = "force-dynamic";

const PAGER =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline";

export default async function AdminPages({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = cleanSearch(params.q);
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10_000 ? rawPage : 1;
  const { rows, total } = await searchPages(q, page);

  const lastPage = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const link = (target: number) =>
    `/admin/pages?${new URLSearchParams({ ...(q ? { q } : {}), ...(target > 1 ? { page: String(target) } : {}) }).toString()}`;

  return (
    <>
      <ScreenHeader breadcrumb="admin / pages" title="Pages" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <form
          method="get"
          action="/admin/pages"
          role="search"
          className="flex flex-col gap-2 hl:flex-row"
        >
          <label htmlFor="admin-search" className="sr-only">
            Search by handle, custom hostname or owner email
          </label>
          <input
            id="admin-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
            placeholder="Handle, custom hostname or owner email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 hl:max-w-[420px]"
          />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-ink bg-ink px-5 text-sm font-semibold text-surface"
          >
            Search
          </button>
        </form>

        {rows.length === 0 ? (
          <Card>
            <p className="text-[15px] text-text-2">
              {q ? `No pages match “${q}”.` : "No pages yet."}
            </p>
          </Card>
        ) : (
          <>
            <PagesTable rows={rows} />
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs text-text-2">
                {total} {total === 1 ? "page" : "pages"}, page {page} of {lastPage}
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={link(page - 1)} className={PAGER}>
                    Previous
                  </Link>
                ) : null}
                {page < lastPage ? (
                  <Link href={link(page + 1)} className={PAGER}>
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        )}
      </ScreenBody>
    </>
  );
}
