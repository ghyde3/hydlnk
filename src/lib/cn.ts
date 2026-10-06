import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type { ClassValue };

/**
 * The one class-name helper of the HYDLNK UI (M9-01): `clsx` joins the conditional parts, then
 * `tailwind-merge` drops a Tailwind utility that a later one in the same variant overrides
 * (`cn("p-2", "p-4")` is `"p-4"`; `cn("text-ink", "text-sm")` keeps both, a color and a size do not
 * conflict). The custom `hl:` breakpoint is read as a variant like any `xx:` prefix, so a later
 * `hl:size-[280px]` replaces an earlier `hl:size-11` and leaves a plain `size-11` alone.
 *
 * Safe in server and client code (no directive, no `server-only`). The HYDLNK UI only: tenant pages
 * draw their own `pg-*` classes and `--t-*` variables and never import this
 * (.claude/rules/tenant-pages.md, a Vitest scan of the tenant graph holds it).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
