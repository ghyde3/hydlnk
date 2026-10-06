import type { MenuItem, MenuMode } from "@/lib/site/menu";

/**
 * The site menu (M11-07): Home and the live sub-pages in the owner's order, the page being drawn
 * marked with `aria-current="page"`. One component for the live page and the editor's preview, so
 * both draw the same markup. `mode` "links" draws anchors with relative hrefs (never routed through
 * `/r`); "text" draws the same entries as plain text, for the private share preview where a link
 * would leave the draft. Entries wrap on a phone and are at least 44px tall (page-renderer.css).
 * Labels are page titles, plain text, escaped like every other text.
 */
export function SiteMenu({ items, mode }: { items: readonly MenuItem[]; mode: MenuMode }) {
  if (items.length === 0) return null;
  return (
    <nav className="pg-menu" aria-label="Site menu" data-menu-mode={mode}>
      <ul className="pg-menu-list">
        {items.map((item) => (
          <li key={`${item.href}`} className="pg-menu-entry">
            {mode === "links" ? (
              <a
                className="pg-menu-item"
                href={item.href}
                {...(item.current ? { "aria-current": "page" as const } : {})}
              >
                {item.label}
              </a>
            ) : (
              <span
                className="pg-menu-item"
                {...(item.current ? { "aria-current": "page" as const } : {})}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
