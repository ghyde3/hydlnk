import type { AnyToolDefinition } from "../types";
import { addBlock } from "./add-block";
import { createEntryTool } from "./create-entry";
import { createPage } from "./create-page";
import { createPreviewLink } from "./create-preview-link";
import { createTermTool } from "./create-term";
import { deleteEntryTool } from "./delete-entry";
import { deleteTermTool } from "./delete-term";
import { getAnalytics } from "./get-analytics";
import { getDomains } from "./get-domains";
import { getEntryTool } from "./get-entry";
import { getPage } from "./get-page";
import { listContentTypes } from "./list-content-types";
import { listEntriesTool } from "./list-entries";
import { listPages } from "./list-pages";
import { listRevisionsTool } from "./list-revisions";
import { listTermsTool } from "./list-terms";
import { moveBlock } from "./move-block";
import { publishDesignTool } from "./publish-design";
import { publishEntryTool } from "./publish-entry";
import { publishPage } from "./publish-page";
import { removeBlock } from "./remove-block";
import { renameTermTool } from "./rename-term";
import { restoreEntryTool } from "./restore-entry";
import { restoreRevisionTool } from "./restore-revision";
import { setTheme } from "./set-theme";
import { unpublishEntryTool } from "./unpublish-entry";
import { updateBlock } from "./update-block";
import { updateContentTypeTool } from "./update-content-type";
import { updateEntryTool } from "./update-entry";
import { updatePageSettings } from "./update-page-settings";
import { updateProfile } from "./update-profile";

/**
 * The thirty-one tools, in the order `tools/list` returns them (M10-21, M18-12): the reads (the
 * first nine, the only ones with `readOnlyHint`), the draft writes, the preview link, then every
 * tool that changes the live site, behind the publish scope, with `publish_page` last. One
 * registry: a tool exists when it is here, and every handler is reached through `runTool`, never
 * directly.
 */
export const TOOLS: readonly AnyToolDefinition[] = [
  listPages,
  getPage,
  getAnalytics,
  getDomains,
  listContentTypes,
  listEntriesTool,
  getEntryTool,
  listTermsTool,
  listRevisionsTool,
  updateProfile,
  addBlock,
  updateBlock,
  moveBlock,
  removeBlock,
  createPage,
  updatePageSettings,
  setTheme,
  createEntryTool,
  updateEntryTool,
  deleteEntryTool,
  restoreEntryTool,
  createTermTool,
  restoreRevisionTool,
  createPreviewLink,
  renameTermTool,
  deleteTermTool,
  publishEntryTool,
  unpublishEntryTool,
  publishDesignTool,
  updateContentTypeTool,
  publishPage,
] as unknown as readonly AnyToolDefinition[];

export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

export function toolByName(name: string): AnyToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
