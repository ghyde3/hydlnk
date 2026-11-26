import "server-only";
import { getEntry, listTypes } from "@/lib/content";
import { MESSAGES } from "./errors";
import type { LoadEntryOptions, LoadEntryResult, OwnedEntry } from "./types";

/**
 * The one place the connector reads an entry (M18-01). It reads through the content writer
 * (`getEntry` joins the site and filters on its owner IN THE QUERY), with the user of the verified
 * token and nothing else. Another account's entry, a random id, a malformed id, a type the tool does
 * not take and the wrong side of the trash are one answer: `not_found`, the same object each time.
 *
 * The published copy never leaves this function: only the slug the live copy is at is kept (the
 * public address of a live post), so no tool can put live text into a result.
 */

/** A failed read is the caller's `server_error`: the message of the database never leaves here. */
export class EntryReadError extends Error {}

const notFound = (): LoadEntryResult => ({
  ok: false,
  failure: { code: "not_found", message: MESSAGES.entry_not_found },
});

const slugOf = (doc: unknown): string | null => {
  const slug = doc && typeof doc === "object" ? (doc as { slug?: unknown }).slug : undefined;
  return typeof slug === "string" && slug !== "" ? slug : null;
};

export async function loadOwnedEntry(
  userId: string,
  entryId: string,
  opts: LoadEntryOptions,
): Promise<LoadEntryResult> {
  const actor = { userId, source: "mcp" as const };
  const found = await getEntry({ actor, entryId });
  if (!found.ok) {
    if (found.error === "not_found") return notFound();
    throw new EntryReadError("reading the entry failed");
  }
  const typeKey = found.typeKey;
  if (typeKey !== "post" && typeKey !== "page") return notFound();
  if (!opts.types.includes(typeKey)) return notFound();
  const trashed = found.status === "trashed";
  if ((opts.trashed === "no" && trashed) || (opts.trashed === "yes" && !trashed)) return notFound();

  // A post whose blog is off: the caller's own, so saying so tells them nothing new.
  if (typeKey !== "page" && !opts.allowDisabledType) {
    const types = await listTypes({ actor, siteId: found.siteId });
    if (!types.ok) {
      if (types.error === "not_found") return notFound();
      throw new EntryReadError("reading the content type failed");
    }
    const type = types.types.find((item) => item.typeId === found.typeId);
    if (!type) return notFound();
    if (!type.enabled) {
      return { ok: false, failure: { code: "type_disabled", message: MESSAGES.blogOff } };
    }
  }

  const entry: OwnedEntry = {
    id: found.id,
    siteId: found.siteId,
    typeId: found.typeId,
    typeKey,
    rev: found.rev,
    status: found.status,
    hasUnpublishedChanges: found.hasUnpublishedChanges,
    publishedAt: found.publishedAt,
    firstPublishedAt: found.firstPublishedAt,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
    deletedAt: found.deletedAt,
    liveSlug: found.status === "published" ? slugOf(found.published) : null,
    ...(opts.withDraft ? { draft: found.draft } : {}),
  };
  return { ok: true, entry };
}
