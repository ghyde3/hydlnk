const BAR =
  "flex flex-col gap-x-4 gap-y-2 bg-ink px-4 py-2 text-on-ink hl:flex-row hl:flex-wrap hl:items-center hl:px-8";
const MONO = "font-mono text-xs";
const LINK =
  "inline-flex min-h-11 items-center rounded-md border border-ink-line px-3 text-[13px] font-semibold text-on-ink no-underline";

/**
 * The bar on top of an admin's view of a draft (M13-11): what it is (read only, logged), the pages
 * of the site as a switcher and a way back. Outside the page's own root element, so HYDLNK tokens and
 * the tenant's never mix. The switcher links are plain anchors on purpose: opening a page is a new
 * viewing and writes its own audit row, so nothing may prefetch one.
 */
export function AdminDraftBar({
  handle,
  accountId,
  pageId,
  current,
  pages,
}: {
  handle: string;
  accountId: string;
  pageId: string;
  /** The path being viewed ("" for Home). */
  current: string;
  pages: { path: string; title: string }[];
}) {
  const entries = [{ path: "", title: "Home" }, ...pages];
  return (
    <div role="status" data-admin-draft-bar="" className={BAR}>
      <div className="flex flex-col gap-0.5">
        <span className={MONO}>Draft view for {handle}. Read only.</span>
        <span className={`${MONO} text-on-ink-muted`}>Each viewing is logged.</span>
      </div>
      <nav aria-label="Pages of this draft" className="flex flex-wrap gap-2 hl:ml-auto">
        {entries.map((entry) => (
          <a
            key={entry.path || "home"}
            href={`/admin-draft/${pageId}${entry.path ? `/${encodeURIComponent(entry.path)}` : ""}`}
            aria-current={entry.path === current ? "page" : undefined}
            className={`${LINK} ${entry.path === current ? "bg-ink-raised" : ""} [overflow-wrap:anywhere]`}
          >
            {entry.title}
          </a>
        ))}
        <a href={`/admin/accounts/${accountId}`} className={LINK}>
          Back to account
        </a>
      </nav>
    </div>
  );
}
