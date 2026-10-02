import Link from "next/link";
import { FOOTER_COLUMNS, SUPPORT_EMAIL } from "./site-map";

const FOOTER_LINK =
  "inline-flex min-h-11 min-w-11 items-center text-sm text-text-2 hover:text-ink hover:underline underline-offset-4";

/**
 * White footer with a 1px top divider: the brand, three link columns (Product, Learn, Legal) and
 * a bottom row with the copyright and the support address. Links are 44px tall on every width.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid w-full max-w-[1200px] gap-x-6 gap-y-8 px-6 pt-12 pb-6 hl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col gap-3">
          <div className="flex min-h-11 items-center gap-2.5">
            <span aria-hidden="true" className="inline-block size-2 rotate-45 bg-brass" />
            <span className="text-[13px] font-bold tracking-[0.14em]">HYDLNK</span>
          </div>
          <p className="max-w-[300px] text-sm leading-[1.6] text-text-2">
            Link in bio, with real design control. Blocks, themes and your own domain.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-x-6 gap-y-8 hl:col-span-3 hl:grid-cols-3"
        >
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase">
                {column.title}
              </p>
              <ul className="mt-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={FOOTER_LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line py-2">
          <p className="inline-flex min-h-11 items-center text-[13px] text-text-2">
            © {new Date().getFullYear()} HYDLNK
          </p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className={`${FOOTER_LINK} font-mono text-[13px]`}>
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
