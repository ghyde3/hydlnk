import { redactLock, stripHiddenCharacters, type Block, type PublishDoc } from "@/lib/document";

/**
 * The shared draft without hidden characters (M6-10). A share link draws a draft that never went
 * through the Publish gate, and a lenient draft may hold what the gate refuses in text: control
 * characters and the bidi overrides and isolates. Drawn as they are, a label could read backwards or
 * pass for a trusted address or for HYDLNK's own words, on the app host, to whoever holds the link.
 * Published pages refuse those characters; a shared draft has them removed, by the gate's own rules
 * (`stripHiddenCharacters`).
 *
 * Every text of the profile and of the blocks is cleaned (the ids, the types and the booleans are not
 * text and are left as they are). A line break survives in one place only: the body of a text block,
 * the one field the gate lets hold them. The tokens and the theme are checked values, not
 * tenant text, and are returned as they are. Pure; the input is not changed.
 */
export function sanitizeSharedDoc(doc: PublishDoc): PublishDoc {
  return {
    ...doc,
    profile: clean(doc.profile),
    // The support banner's message and label (M9-23) are text like any other.
    ...(doc.banner ? { banner: clean(doc.banner) } : {}),
    blocks: doc.blocks.map(sanitizeBlock),
  };
}

function sanitizeBlock(block: Block): Block {
  const cleaned = clean(block);
  // A link's lock (M9-29): the salt and hash never leave the owner's session. The marker keeps its
  // kind (the shared link still draws the padlock) and the renderer gives the link no href there.
  if (block.type === "link" && cleaned.type === "link" && block.lock !== undefined) {
    const lock = redactLock(block.lock);
    if (lock) return { ...cleaned, lock };
  }
  if (block.type === "text" && cleaned.type === "text") {
    return { ...cleaned, text: stripHiddenCharacters(block.text, { multiline: true }) };
  }
  return cleaned;
}

/** A copy of a JSON-like value with every string cleaned (single-line rules). */
function clean<T>(value: T): T {
  if (typeof value === "string") return stripHiddenCharacters(value) as T;
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = clean(item);
    return out as T;
  }
  return value;
}
