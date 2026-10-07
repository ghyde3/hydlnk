import { z } from "zod";
import { HANDLE_PATTERN } from "@/lib/schemas/handle";
import { fail, type ActionResult, type AdminAction } from "./types";
import { latestAudit, looseDb, writeAudit } from "./audit-detail";

/**
 * The two admin actions behind /admin/reserved (M13-08): reserve a handle and remove a reservation.
 *
 * A reservation only stops NEW claims (the pages trigger refuses a reserved handle on insert and on a
 * change of handle, HL004): a page that already holds the handle is not touched, and adding a taken
 * handle answers with its holder so the admin sees whose it is. System names (kind 'system': app,
 * www, api and the rest of the routing list) are locked: the database function refuses to remove one
 * and this action says so (409 `locked`). The retry rule of every admin mutation applies: the change,
 * then the audit row, and a retry writes a row an earlier call died before writing.
 */

export const REASON_MAX = 200;
export const INVALID_HANDLE_MESSAGE =
  "A handle is 3 to 30 characters: lowercase letters, numbers and hyphens, not starting or ending with a hyphen.";
const INVALID_REQUEST = "That request isn’t valid.";

const handleOf = (raw: string): string | null => {
  const handle = raw.trim().toLowerCase();
  return HANDLE_PATTERN.test(handle) ? handle : null;
};

const addInput = z.object({
  handle: z.string().max(100),
  reason: z.string().max(1000).default(""),
});
const removeInput = z.object({ handle: z.string().max(100) });

export const addReservedHandleAction: AdminAction = {
  name: "add_reserved_handle",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = addInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID_REQUEST);
    const handle = handleOf(parsed.data.handle);
    if (handle === null) return fail(400, "invalid_input", INVALID_HANDLE_MESSAGE);
    const reason = parsed.data.reason.trim();
    if (reason.length > REASON_MAX) {
      return fail(400, "invalid_input", `The reason is at most ${REASON_MAX} characters.`);
    }

    const db = looseDb(context);
    const { data, error } = await db.rpc("admin_add_reserved_handle", {
      p_handle: handle,
      p_reason: reason,
      p_admin: context.actor.id,
    });
    if (error) throw new Error(`Reserving the handle failed: ${error.message}`);
    const row = (data as Array<Record<string, string | null>> | null)?.[0];
    if (!row) throw new Error("Reserving the handle returned nothing");
    const holder = row.holder_page_id
      ? { pageId: row.holder_page_id, email: row.holder_email ?? null }
      : null;

    if (row.outcome === "added") {
      await writeAudit(db, context.actor.id, "reserve_handle", {
        handle,
        reason,
        holder_page_id: holder?.pageId ?? null,
      });
      return { ok: true, status: 200, data: { changed: true, handle, holder } };
    }

    // Already reserved. A plain duplicate, or an earlier add whose audit row was never written (the
    // entry has an author and the newest row for the handle is not a reservation).
    const entry = await db
      .from("reserved_handles")
      .select("added_by, reason, kind")
      .eq("handle", handle)
      .maybeSingle();
    if (entry.error) throw new Error(`Reading the reservation failed: ${entry.error.message}`);
    const stored = entry.data as { added_by: string | null; reason: string | null } | null;
    if (stored?.added_by) {
      const last = await latestAudit(db, ["reserve_handle", "unreserve_handle"], "handle", handle);
      if (last === null || last.action !== "reserve_handle") {
        await writeAudit(db, stored.added_by, "reserve_handle", {
          handle,
          reason: stored.reason ?? "",
          holder_page_id: holder?.pageId ?? null,
          retried: true,
          retried_by: context.actor.id,
        });
      }
    }
    return fail(409, "already_reserved", `${handle} is already reserved.`);
  },
};

export const removeReservedHandleAction: AdminAction = {
  name: "remove_reserved_handle",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = removeInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID_REQUEST);
    const handle = handleOf(parsed.data.handle);
    if (handle === null) return fail(400, "invalid_input", INVALID_REQUEST);

    const db = looseDb(context);
    const before = await db
      .from("reserved_handles")
      .select("reason, kind")
      .eq("handle", handle)
      .maybeSingle();
    if (before.error) throw new Error(`Reading the reservation failed: ${before.error.message}`);
    const was = before.data as { reason: string | null; kind: string } | null;

    const removed = await db.rpc("admin_remove_reserved_handle", { p_handle: handle });
    if (removed.error) throw new Error(`Removing the reservation failed: ${removed.error.message}`);
    const outcome = removed.data as string;

    if (outcome === "locked") {
      return fail(409, "locked", `${handle} is a platform name. It stays reserved.`);
    }
    if (outcome === "removed") {
      await writeAudit(db, context.actor.id, "unreserve_handle", {
        handle,
        reason: was?.reason ?? "",
      });
      return { ok: true, status: 200, data: { changed: true, handle } };
    }
    // Not reserved: a second click, or an earlier call that deleted it and died before its audit row.
    const last = await latestAudit(db, ["reserve_handle", "unreserve_handle"], "handle", handle);
    if (last?.action === "reserve_handle") {
      const earlier = last.detail.reason;
      await writeAudit(db, context.actor.id, "unreserve_handle", {
        handle,
        reason: typeof earlier === "string" ? earlier : "",
        retried: true,
      });
    }
    return { ok: true, status: 200, data: { changed: false, handle } };
  },
};
