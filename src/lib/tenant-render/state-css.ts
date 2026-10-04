import "server-only";
import { tenantStateCss } from "@/lib/tenant-assets";
import { filterCss, parseCss, serializeCss, type CssNode } from "@/lib/tenant-assets/css-split";

/**
 * The inline stylesheet of the states that are not a tenant's page (M8-03): the placeholder, the
 * 404 panels and the 500 panel. `tenantStateCss()` is every rule of tenant.css; each state keeps
 * only the rules whose `.tenant-*` classes it actually uses, found by reading the markup it was
 * rendered to. That keeps the HYDLNK-styled panels free of the tenant theme's `--t-*` variables
 * (their colors are inline literals, M5-08) and the placeholder free of the panels' rules. Rules
 * with no `.tenant-*` class (the text-size and margin resets) are always kept.
 */

let nodes: CssNode[] | undefined;
const memo = new Map<string, string>();

const CLASS_ATTRIBUTE = /\sclass="([^"]*)"/g;
const TENANT_CLASS = /\.(tenant-[a-z0-9-]+)/g;

export function usedClasses(markup: string): Set<string> {
  const used = new Set<string>();
  for (const match of markup.matchAll(CLASS_ATTRIBUTE)) {
    for (const name of match[1]!.split(/\s+/)) if (name) used.add(name);
  }
  return used;
}

/** The text of the state document's `<style>`, for the markup it holds. */
export function stateCssFor(markup: string): string {
  const used = usedClasses(markup);
  const key = [...used].filter((name) => name.startsWith("tenant-")).sort().join(" ");
  let css = memo.get(key);
  if (css === undefined) {
    nodes ??= parseCss(tenantStateCss());
    css = serializeCss(
      filterCss(nodes, (selector) =>
        [...selector.matchAll(TENANT_CLASS)].every((match) => used.has(match[1]!)),
      ),
    );
    memo.set(key, css);
  }
  return css;
}
