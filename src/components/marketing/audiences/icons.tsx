import type { ReactNode } from "react";
import { BLOCK_CATALOG } from "../block-catalog";
import { Icon } from "../primitives";
import type { BlockId, FitIcon } from "./data";

const EXTRA: Record<Exclude<FitIcon, BlockId>, ReactNode> = {
  design: (
    <Icon>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.7-.8 1.7-1.6 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.9 16.7 3.5 12 3.5z" />
      <circle cx="8" cy="11" r="1" />
      <circle cx="11" cy="7.5" r="1" />
      <circle cx="15.5" cy="8.5" r="1" />
    </Icon>
  ),
  phone: (
    <Icon>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </Icon>
  ),
  chart: (
    <Icon>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </Icon>
  ),
  domain: (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.2 3.3 4.9 3.3 8s-1.1 5.8-3.3 8c-2.2-2.2-3.3-4.9-3.3-8S9.8 6.2 12 4z" />
    </Icon>
  ),
  preview: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15l3-3 2 2 3-4 3 5" />
    </Icon>
  ),
  tag: (
    <Icon>
      <path d="M4 12.5V5a1 1 0 0 1 1-1h7.5l7.5 7.5-8.5 8.5z" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </Icon>
  ),
};

/** The 20px glyph for a feature card or a block row: a block's own icon, or one of the general ones. */
export function AudienceIcon({ name }: { name: FitIcon }): ReactNode {
  const block = BLOCK_CATALOG.find((item) => item.id === name);
  if (block) return block.icon;
  return EXTRA[name as Exclude<FitIcon, BlockId>] ?? null;
}

/** The block's display name ("Embed", "Grid"), for the chip beside a starter-page row. */
export function blockName(id: BlockId): string {
  return BLOCK_CATALOG.find((item) => item.id === id)?.name ?? id;
}
