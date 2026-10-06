import { HOME_TARGET } from "@/lib/document";
import { ToolFailure } from "../errors";
import { listSubPageSummaries, PageReadError } from "../page-access";
import { MESSAGES } from "../errors";
import type { ToolCall } from "../types";

/**
 * A `page_link` must point at Home or at a page of the same site (M12-05): the draft would keep any
 * text, and Publish refuses one that names no page of the site, so the tool says so now. The pages
 * are read under the caller's own site.
 */
export async function assertPageLinkTarget(call: ToolCall, target: string): Promise<void> {
  if (target === HOME_TARGET) return;
  let pages;
  try {
    pages = await listSubPageSummaries(call.admin, call.userId, [call.page!.id]);
  } catch (error) {
    if (error instanceof PageReadError) throw new ToolFailure("server_error", MESSAGES.serverError);
    throw error;
  }
  if (pages.some((page) => page.id === target)) return;
  const message =
    "target must be home or the id of a page of this site. Call list_pages for the ids.";
  throw new ToolFailure("invalid_input", message, {
    issues: [{ path: "fields.target", message }],
  });
}
