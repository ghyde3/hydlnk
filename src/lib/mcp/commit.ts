import "server-only";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import type { DraftDoc } from "@/lib/document";
import { writeDraft, type ChangeOutcome, type WriteDraftResult } from "@/lib/editor/draft-write";
import { MESSAGES, ToolFailure } from "./errors";
import type { ToolCall } from "./types";

/**
 * A tool's write: `writeDraft` for the call's page, with the media cleanup scheduled after the
 * response when the change dropped an image (the same queue the editor works off, M5-14). Every
 * write tool goes through this one function, so none of them can skip the revision guard.
 */
export async function commitDraft<T>(
  call: ToolCall,
  ifRev: number | undefined,
  change: (doc: DraftDoc) => ChangeOutcome<T> | Promise<ChangeOutcome<T>>,
): Promise<WriteDraftResult<T>> {
  if (!call.page) throw new ToolFailure("server_error", MESSAGES.serverError);
  const result = await writeDraft({
    admin: call.admin,
    userId: call.userId,
    pageId: call.page.id,
    ifRev,
    change,
  });
  if (result.droppedImages) {
    call.defer(() => cleanupMediaQuietly(call.userId, call.admin as never));
  }
  return result;
}
