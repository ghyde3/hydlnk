import Link from "next/link";
import { ReservedManager } from "@/components/admin/reserved-manager";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { listReservedHandles } from "@/lib/admin/reserved-queries";
import {
  RESERVED_PAGE_SIZE,
  parseReservedKind,
  parseReservedPage,
  parseReservedQuery,
} from "@/lib/admin/reserved-view";

export const metadata = { title: "Reserved handles" };
export const dynamic = "force-dynamic";

const PAGER =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline";
const CONTROL =
  "min-h-11 w-full min-w-0 rounded-md border border-line-3 bg-surface px-3 text-base text-ink";

/**
 * /admin/reserved (M13-08): the handles nobody can claim. Search by handle, filter by kind, add one
 * with a reason and remove an added one; platform names are locked. A reservation only stops new
 * claims. A non-admin gets the app's 404 from `requireAdmin`; every change is guarded again on the
 * server (`add_reserved_handle` and `remove_reserved_handle`, both audited).
 */
export default async function AdminReserved({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    kind?: string | string[];
    page?: string | string[];
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = parseReservedQuery(params.q);
  const kind = parseReservedKind(params.kind);
  const page = parseReservedPage(params.page);
  const { rows, total } = await listReservedHandles({ query, kind, page });
  const link = (target: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (kind) next.set("kind", kind);
    if (target > 1) next.set("page", String(target));
    const text = next.toString();
    return text ? `/admin/reserved?${text}` : "/admin/reserved";
  };
  const hasMore = page * RESERVED_PAGE_SIZE < total;

  return (
    <>
      <ScreenHeader breadcrumb="admin / reserved handles" title="Reserved handles" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <p className="text-sm leading-relaxed text-text-2">
          Nobody can sign up with these handles or rename a page to one. A page that already uses a
          handle keeps it. Platform names such as app, www and api are locked.
        </p>
        <form
          method="get"
          action="/admin/reserved"
          role="search"
          aria-label="Search reserved handles"
          className="grid gap-3 hl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] hl:items-end"
        >
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
            Search
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Part of a handle"
              autoComplete="off"
              className={CONTROL}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
            Kind
            <select name="kind" defaultValue={kind ?? ""} className={CONTROL}>
              <option value="">All</option>
              <option value="admin">Added</option>
              <option value="system">Platform names</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink"
          >
            Search
          </button>
        </form>
        <p className="font-mono text-xs text-text-2">
          {total} {total === 1 ? "handle" : "handles"}
        </p>
        <ReservedManager rows={rows} />
        {page > 1 || hasMore ? (
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs text-text-2">
              Page {page}, {RESERVED_PAGE_SIZE} a page
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
