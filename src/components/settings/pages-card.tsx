import { Card } from "@/components/app/screen";
import { PRODUCT_DOMAIN } from "@/lib/pages/plans";
import { DeletePageDialog } from "./delete-page-dialog";

export interface PagesCardPage {
  id: string;
  handle: string;
  /** The page's private name (M6-13), shown above its address. */
  name: string;
  published: boolean;
}

/**
 * The Pages card (M4-19): each of the account's pages with its name (M6-14) over its
 * "{handle}.hydlnk.com" address, its Live or Not published chip and a danger "Delete page" button
 * that opens the confirmation dialog. Sits below the plan cards and above Account.
 */
export function PagesCard({ pages }: { pages: PagesCardPage[] }) {
  return (
    <Card className="flex flex-col gap-3.5">
      <h2 className="text-sm font-semibold">Sites</h2>
      <ul className="flex flex-col">
        {pages.map((page) => (
          <li
            key={page.id}
            data-page-row={page.handle}
            className="flex flex-col gap-2.5 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0 hl:flex-row hl:items-center hl:justify-between"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span
                  data-page-name=""
                  className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]"
                >
                  {page.name}
                </span>
                <span
                  id={`page-address-${page.id}`}
                  className="min-w-0 font-mono text-[13px] [overflow-wrap:anywhere]"
                >
                  {page.handle}
                  <span className="text-text-3">.{PRODUCT_DOMAIN}</span>
                </span>
              </div>
              <PageChip published={page.published} />
            </div>
            <div className="hl:shrink-0">
              <DeletePageDialog pageId={page.id} handle={page.handle} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Live (green) once the page has been published, Not published (neutral) before. */
function PageChip({ published }: { published: boolean }) {
  return (
    <span
      data-page-status={published ? "live" : "not-published"}
      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-[5px] text-xs font-medium"
      style={
        published
          ? { background: "#E7F3EC", color: "#2B7448" }
          : { background: "#EFEDE9", color: "#5E5A54" }
      }
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full"
        style={{ background: published ? "#2F7D4F" : "#5E5A54" }}
      />
      {published ? "Live" : "Not published"}
    </span>
  );
}
