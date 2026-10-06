import { z } from "zod";
import { fail, type ActionResult, type AdminAction } from "./types";
import { looseDb, writeAudit } from "./audit-detail";
import { validateAnnouncement } from "@/lib/announcements/rules";

/**
 * The two admin actions behind /admin/announcement (M13-09): set the one message and clear it.
 *
 * `admin_set_announcement` replaces whatever is active or scheduled (the windows never overlap) and
 * `admin_clear_announcement` ends the active one now and removes a scheduled one. Both write one
 * `admin_audit` row after the change, and a failure to write it fails the action (500).
 *
 * The rules of the message (plain text up to 200 characters, one https link at most, an end after the
 * start and in the future) are `validateAnnouncement`, shared with the screen; the table repeats them
 * as constraints. Clearing names the announcement it was shown (`id`), so a stale screen cannot clear
 * a message another admin has just set.
 */

const setInput = z.object({
  message: z.string().max(2000),
  link: z.string().max(4096).nullish(),
  starts_at: z.string().max(64).nullish(),
  ends_at: z.string().max(64),
});
const clearInput = z.object({ id: z.guid() });

export const setAnnouncementAction: AdminAction = {
  name: "set_announcement",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = setInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", "That request isn’t valid.");
    const checked = validateAnnouncement(parsed.data, context.deps.now());
    if (!checked.ok) return fail(400, "invalid_input", checked.message);
    const value = checked.value;

    const db = looseDb(context);
    const { data, error } = await db.rpc("admin_set_announcement", {
      p_message: value.message,
      p_link: value.link,
      p_starts: value.startsAt,
      p_ends: value.endsAt,
      p_admin: context.actor.id,
    });
    if (error) throw new Error(`Setting the announcement failed: ${error.message}`);
    const id = typeof data === "string" ? data : null;
    await writeAudit(db, context.actor.id, "set_announcement", {
      id,
      message: value.message,
      link: value.link,
      starts_at: value.startsAt,
      ends_at: value.endsAt,
    });
    return { ok: true, status: 200, data: { changed: true, id } };
  },
};

export const clearAnnouncementAction: AdminAction = {
  name: "clear_announcement",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = clearInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", "That request isn’t valid.");
    const id = parsed.data.id.toLowerCase();

    const db = looseDb(context);
    const found = await db.from("announcements").select("id, ends_at").eq("id", id).maybeSingle();
    if (found.error) throw new Error(`Reading the announcement failed: ${found.error.message}`);
    const row = found.data as { id: string; ends_at: string } | null;
    if (!row) return fail(404, "not_found", "That announcement doesn’t exist.");
    // Already over (a second click, or it ran out): nothing to end.
    if (Date.parse(row.ends_at) <= context.deps.now().getTime()) {
      return { ok: true, status: 200, data: { changed: false, id } };
    }

    const cleared = await db.rpc("admin_clear_announcement");
    if (cleared.error)
      throw new Error(`Clearing the announcement failed: ${cleared.error.message}`);
    const touched = typeof cleared.data === "number" ? cleared.data : 0;
    await writeAudit(db, context.actor.id, "clear_announcement", { id, rows: touched });
    return { ok: true, status: 200, data: { changed: touched > 0, id } };
  },
};
