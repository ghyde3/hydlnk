import "server-only";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import type { DraftDoc, SubPageDraft } from "@/lib/document";
import {
  writeDraft,
  type BlocksDoc,
  type ChangeOutcome,
  type WriteDraftResult,
} from "@/lib/editor/draft-write";
import { MESSAGES, ToolFailure } from "./errors";
import type { ToolCall } from "./types";

/**
 * A tool's write: `writeDraft` for the call's page, with the media cleanup scheduled after the
 * response when the change dropped an image (the same queue the editor works off, M5-14). Every
 * write tool goes through this one function, so none of them can skip the revision guard.
 *
 * `commitDraft` is for what only Home has (the profile, the theme, the menu). `commitBlocks` is for
 * the tools that edit blocks: it writes the sub-page named by `subPageId` when the call has one, and
 * Home otherwise (M12-05); the callback sees `doc.blocks` either way.
 */
async function commit<T, D extends BlocksDoc>(
  call: ToolCall,
  ifRev: number | undefined,
  subPageId: string | undefined,
  change: (doc: D) => ChangeOutcome<T, D> | Promise<ChangeOutcome<T, D>>,
): Promise<WriteDraftResult<T, D>> {
  if (!call.page) throw new ToolFailure("server_error", MESSAGES.serverError);
  const result = await writeDraft<T, D>({
    admin: call.admin,
    userId: call.userId,
    pageId: call.page.id,
    subPageId,
    ifRev,
    change,
  });
  if (result.droppedImages) {
    call.defer(() => cleanupMediaQuietly(call.userId, call.admin as never));
  }
  return result;
}

export function commitDraft<T>(
  call: ToolCall,
  ifRev: number | undefined,
  change: (doc: DraftDoc) => ChangeOutcome<T> | Promise<ChangeOutcome<T>>,
): Promise<WriteDraftResult<T>> {
  return commit<T, DraftDoc>(call, ifRev, undefined, change);
}

export function commitBlocks<T>(
  call: ToolCall,
  ifRev: number | undefined,
  change: (doc: BlocksDoc) => ChangeOutcome<T, BlocksDoc> | Promise<ChangeOutcome<T, BlocksDoc>>,
): Promise<WriteDraftResult<T, BlocksDoc>> {
  return commit<T, BlocksDoc>(call, ifRev, call.subPage?.id, change);
}

/** Writes the sub-page the call names (`subPageId`), for what only a sub-page has: its title, description and path. */
export function commitSubPage<T>(
  call: ToolCall,
  ifRev: number | undefined,
  change: (
    doc: SubPageDraft,
  ) => ChangeOutcome<T, SubPageDraft> | Promise<ChangeOutcome<T, SubPageDraft>>,
): Promise<WriteDraftResult<T, SubPageDraft>> {
  if (!call.subPage) throw new ToolFailure("server_error", MESSAGES.serverError);
  return commit<T, SubPageDraft>(call, ifRev, call.subPage.id, change);
}
