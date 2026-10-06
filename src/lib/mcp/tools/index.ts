import type { AnyToolDefinition } from "../types";
import { addBlock } from "./add-block";
import { createPage } from "./create-page";
import { createPreviewLink } from "./create-preview-link";
import { getAnalytics } from "./get-analytics";
import { getDomains } from "./get-domains";
import { getPage } from "./get-page";
import { listPages } from "./list-pages";
import { moveBlock } from "./move-block";
import { publishPage } from "./publish-page";
import { removeBlock } from "./remove-block";
import { setTheme } from "./set-theme";
import { updateBlock } from "./update-block";
import { updatePageSettings } from "./update-page-settings";
import { updateProfile } from "./update-profile";

/**
 * The fourteen tools, in the order `tools/list` returns them (M10-21). One registry: a tool exists
 * when it is here, and every handler is reached through `runTool`, never directly.
 */
export const TOOLS: readonly AnyToolDefinition[] = [
  listPages,
  getPage,
  getAnalytics,
  getDomains,
  updateProfile,
  addBlock,
  updateBlock,
  moveBlock,
  removeBlock,
  createPage,
  updatePageSettings,
  setTheme,
  createPreviewLink,
  publishPage,
] as unknown as readonly AnyToolDefinition[];

export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

export function toolByName(name: string): AnyToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
