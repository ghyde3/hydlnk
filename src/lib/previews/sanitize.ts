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

/** Control characters a Markdown body may not show: all but the line feed and the tab (indented code). */
const BODY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const BODY_BIDI = /[\u202a-\u202e\u2066-\u2069]/g;

/** The texts of a post draft as the share preview draws them. */
export interface SharedPostText {
  title: string;
  excerpt: string;
  body: string;
  seo: { title?: string; description?: string; noindex?: boolean };
}

/**
 * A post's saved draft without hidden characters (M16-16), for the same reason as
 * `sanitizeSharedDoc`: the share link draws a draft that never met the Publish gate, on the app
 * host. The title and the SEO fields follow the single-line rule, the excerpt keeps its line
 * breaks, and the Markdown body keeps line breaks and tabs (an indented code block) and loses every
 * other control character and the bidi overrides and isolates. The body's HTML, links and images
 * are not this function's business: `PostBody` draws raw HTML as text and vets every `href` and
 * `src` itself. Pure; the input is not changed; a missing text is "".
 */
export function sanitizeSharedPost(draft: {
  title?: string | undefined;
  excerpt?: string | undefined;
  body?: string | undefined;
  seo?:
    | {
        title?: string | undefined;
        description?: string | undefined;
        noindex?: boolean | undefined;
      }
    | undefined;
}): SharedPostText {
  const line = (value: string | undefined) => stripHiddenCharacters(value ?? "");
  const seo: SharedPostText["seo"] = {};
  if (draft.seo?.title !== undefined) seo.title = line(draft.seo.title);
  if (draft.seo?.description !== undefined) seo.description = line(draft.seo.description);
  if (draft.seo?.noindex !== undefined) seo.noindex = draft.seo.noindex;
  return {
    title: line(draft.title),
    excerpt: stripHiddenCharacters(draft.excerpt ?? "", { multiline: true }),
    body: (draft.body ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(BODY_CONTROL, "")
      .replace(BODY_BIDI, ""),
    seo,
  };
}
