import { z } from "zod";
import { fail, type ActionResult, type AdminAction } from "./types";
import { latestAudit, looseDb, writeAudit } from "./audit-detail";

/**
 * The two admin actions behind /admin/apps (M13-10): revoke a connected AI app for everyone, and
 * restore it. The app is named in the body (`client_id`: a registered client is `hlc_` and 32 hex
 * characters, a metadata client is an https address, which does not fit a path segment).
 *
 *   block_app    admin_block_oauth_client ends every grant and token of the app, drops its open requests
 *                and codes, and sets `oauth_clients.blocked_at`. The authorize and token endpoints refuse
 *                a client with that set (src/lib/oauth), and the metadata upsert never writes it, so a
 *                re-fetch cannot lift it. Needs a reason (at most 500 characters).
 *   unblock_app  clears `blocked_at`. The ended grants stay ended: people connect the app again.
 *
 * Each writes one `admin_audit` row after the change; a retry that finds the change made writes a row
 * the earlier call died before writing. Nothing here reads a person, a token or tool content.
 */

export const APP_REASON_MAX = 500;
const INVALID = "That request isn’t valid.";

const clientId = z.string().min(1).max(2048);
const blockInput = z.object({ client_id: clientId, reason: z.string().max(5000).default("") });
const unblockInput = z.object({ client_id: clientId });

const NOT_FOUND = "That app doesn’t exist.";

async function nameOf(db: ReturnType<typeof looseDb>, id: string): Promise<string | null> {
  const { data, error } = await db
    .from("oauth_clients")
    .select("client_name")
    .eq("client_id", id)
    .maybeSingle();
  if (error) throw new Error(`Reading the app failed: ${error.message}`);
  return (data as { client_name: string } | null)?.client_name ?? null;
}

export const blockAppAction: AdminAction = {
  name: "block_app",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = blockInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID);
    const reason = parsed.data.reason.trim();
    if (reason === "") return fail(400, "invalid_input", "Give a reason.");
    if (reason.length > APP_REASON_MAX) {
      return fail(400, "invalid_input", `The reason is at most ${APP_REASON_MAX} characters.`);
    }
    const id = parsed.data.client_id;

    const db = looseDb(context);
    const { data, error } = await db.rpc("admin_block_oauth_client", {
      p_client_id: id,
      p_admin: context.actor.id,
      p_reason: reason,
    });
    if (error) throw new Error(`Blocking the app failed: ${error.message}`);
    const row = (
      data as Array<{ outcome: string; grants_ended: number; tokens_ended: number }> | null
    )?.[0];
    if (!row) throw new Error("Blocking the app returned nothing");
    if (row.outcome === "missing") return fail(404, "not_found", NOT_FOUND);

    if (row.outcome === "blocked") {
      await writeAudit(db, context.actor.id, "block_app", {
        client_id: id,
        client_name: await nameOf(db, id),
        reason,
        grants_ended: row.grants_ended,
        tokens_ended: row.tokens_ended,
      });
      return {
        ok: true,
        status: 200,
        data: { changed: true, grantsEnded: row.grants_ended, tokensEnded: row.tokens_ended },
      };
    }

    // Already blocked: a second click, or an earlier call that blocked it and died before its audit row.
    const last = await latestAudit(db, ["block_app", "unblock_app"], "client_id", id);
    if (last?.action !== "block_app") {
      await writeAudit(db, context.actor.id, "block_app", {
        client_id: id,
        client_name: await nameOf(db, id),
        reason,
        grants_ended: 0,
        tokens_ended: 0,
        retried: true,
      });
    }
    return { ok: true, status: 200, data: { changed: false, grantsEnded: 0, tokensEnded: 0 } };
  },
};

export const unblockAppAction: AdminAction = {
  name: "unblock_app",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = unblockInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID);
    const id = parsed.data.client_id;

    const db = looseDb(context);
    const { data, error } = await db.rpc("admin_unblock_oauth_client", { p_client_id: id });
    if (error) throw new Error(`Restoring the app failed: ${error.message}`);
    if (data === "missing") return fail(404, "not_found", NOT_FOUND);

    if (data === "unblocked") {
      await writeAudit(db, context.actor.id, "unblock_app", {
        client_id: id,
        client_name: await nameOf(db, id),
      });
      return { ok: true, status: 200, data: { changed: true } };
    }
    // Not blocked: a second click, never blocked, or an earlier call that restored it and died before
    // its audit row (the newest row for the app is then still its block).
    const last = await latestAudit(db, ["block_app", "unblock_app"], "client_id", id);
    if (last?.action === "block_app") {
      await writeAudit(db, context.actor.id, "unblock_app", {
        client_id: id,
        client_name: await nameOf(db, id),
        retried: true,
      });
    }
    return { ok: true, status: 200, data: { changed: false } };
  },
};
