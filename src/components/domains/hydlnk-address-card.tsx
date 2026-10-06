import { PRODUCT_DOMAIN } from "@/lib/pages/plans";

/**
 * "Your HYDLNK address" (M4-10): the current page's {handle}.hydlnk.com in mono 17px, what it is
 * included in, a green "Live" chip once the page is published (a neutral "Not published yet"
 * before) and a neutral "SSL" chip. It follows the page switcher: the address is the current
 * page's, while the domains below are the whole account's.
 */
export function HydlnkAddressCard({ handle, published }: { handle: string; published: boolean }) {
  return (
    <section
      aria-labelledby="hydlnk-address-heading"
      data-hydlnk-address
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4 hl:p-5"
    >
      <div className="min-w-0">
        <h2 id="hydlnk-address-heading" className="text-sm font-semibold">
          Your HYDLNK address
        </h2>
        <div
          data-hydlnk-address-value
          className="mt-2 font-mono text-[17px] [overflow-wrap:anywhere]"
        >
          {handle}.{PRODUCT_DOMAIN}
        </div>
        <p className="mt-1 text-[13px] text-text-2">
          Included on every plan. Keeps working alongside a custom domain.
        </p>
      </div>
      <div className="flex gap-1.5">
        {published ? (
          <span
            data-address-chip="live"
            className="inline-flex items-center gap-1.5 rounded-sm bg-good-bg px-2 py-1 text-xs font-medium text-good"
          >
            <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-good" />
            Live
          </span>
        ) : (
          <span
            data-address-chip="unpublished"
            className="inline-flex items-center rounded-sm bg-track px-2 py-1 text-xs font-medium text-text-2"
          >
            Not published yet
          </span>
        )}
        <span className="inline-flex items-center rounded-sm bg-track px-2 py-1 text-xs font-medium text-text-2">
          SSL
        </span>
      </div>
    </section>
  );
}
