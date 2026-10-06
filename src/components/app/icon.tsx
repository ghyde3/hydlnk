import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * The one way the HYDLNK UI draws an icon (M9-02): a Lucide icon on its 24 grid, round caps and
 * joins, `currentColor`, decorative. A call site imports the glyph by name from "lucide-react" and
 * passes it with the size:
 *
 *   import { Pencil } from "lucide-react";
 *   <Icon icon={Pencil} size={16} />
 *
 * The wrapper sets `aria-hidden="true"`, `focusable="false"` and `shrink-0` once. The control that
 * holds the icon keeps its own `aria-label` or visible text: an icon never names anything and never
 * carries a `<title>`. `strokeWidth` is 1.8; the editor's own icons (upload, undo, redo, rename)
 * pass 1.9, as their hand-drawn predecessors had. docs/DESIGN.md has the sizes.
 *
 * App side only: the public page (`src/components/page`), the marketing site and the tenant
 * renderer never import it, because Lucide's `Icon` is a client component and the live page is
 * finished HTML (M8-02).
 */
export const ICON_STROKE = 1.8;
export const EDITOR_ICON_STROKE = 1.9;
/** A check mark drawn on a filled circle or beside a field: heavier, as its hand-drawn predecessor was. */
export const CHECK_ON_FILL_STROKE = 2.4;

export function Icon({
  icon: Glyph,
  size = 16,
  strokeWidth = ICON_STROKE,
  className,
  style,
}: {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Only for a value that is computed at render (the gradient arrow's rotation). */
  style?: CSSProperties;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      style={style}
    />
  );
}
