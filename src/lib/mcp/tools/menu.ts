import { NAV_MAX_ITEMS, NAV_MESSAGES, resolveNav, type Nav } from "@/lib/document";
import { commitDraft } from "../commit";
import { ToolFailure } from "../errors";
import type { ToolCall } from "../types";

/**
 * The site menu is Home's `nav`: an ordered list of sub-page ids (M11-07). These two helpers are the
 * only code in the tools that changes it. Both work on a copy and never touch `show`.
 */

export interface MenuChange {
  inMenu?: boolean | undefined;
  /** Where the page goes in the menu, counting from 0. */
  position?: number | undefined;
}

function refuse(path: string, message: string): never {
  throw new ToolFailure("invalid_input", message, { issues: [{ path, message }] });
}

/** `nav` with the change applied to the page `id`; refuses what the menu cannot hold. */
export function applyMenuChange(
  nav: Partial<Nav> | undefined,
  id: string,
  change: MenuChange,
): Nav {
  const current = resolveNav(nav);
  const present = current.items.includes(id);
  if (change.inMenu === false) {
    if (change.position !== undefined) {
      refuse(
        "menuPosition",
        "menuPosition goes with inMenu true. Leave it out to take the page out.",
      );
    }
    return { show: current.show, items: current.items.filter((item) => item !== id) };
  }
  if (change.inMenu === undefined && !present) {
    refuse("inMenu", "This page isn’t in the menu. Send inMenu: true to add it.");
  }
  const rest = current.items.filter((item) => item !== id);
  if (!present && rest.length >= NAV_MAX_ITEMS) refuse("inMenu", NAV_MESSAGES.menuFull);
  const at =
    change.position === undefined
      ? present
        ? current.items.indexOf(id)
        : rest.length
      : change.position;
  const index = Math.min(at, rest.length);
  return { show: current.show, items: [...rest.slice(0, index), id, ...rest.slice(index)] };
}

/**
 * Writes the change into Home's draft, bumping Home's rev (so an open editor sees a conflict and
 * reloads instead of overwriting it). The change is made again on a fresh read when an autosave got
 * in first, up to three times. Returns Home's rev now, and whether the menu changed.
 */
export async function writeMenuChange(
  call: ToolCall,
  id: string,
  change: MenuChange,
): Promise<{ rev: number; changed: boolean; nav: Nav }> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await commitDraft(call, undefined, (doc) => {
        const next = applyMenuChange(doc.nav, id, change);
        if (JSON.stringify(next.items) === JSON.stringify(resolveNav(doc.nav).items)) {
          return { kind: "unchanged", value: next };
        }
        return { kind: "write", doc: { ...doc, nav: next }, value: next };
      });
      return { rev: result.rev, changed: !result.unchanged, nav: result.value };
    } catch (error) {
      last = error;
      if (!(error instanceof ToolFailure && error.code === "conflict")) throw error;
    }
  }
  throw last;
}
