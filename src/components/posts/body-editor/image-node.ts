import { Node } from "@tiptap/core";

/**
 * The image of a post body (M16-13): an inline atom with `src` and `alt`, written to Markdown as
 * `![alt](src)` and read back from Markdown's `image` token. In-house on `@tiptap/core`, because no
 * Tiptap image extension is on the approved list.
 *
 * `src` is what is stored: the Storage address of one of the owner's uploads (`storageUrl(path)`),
 * the only form Publish accepts. The editor never loads `src` itself: `display` maps it to the
 * address a browser may draw (the `/media` route) or to null, and an image with no drawable address
 * shows its alt text in a box instead. So a remote image in a body written elsewhere is never
 * fetched by the editor.
 */
export interface BodyImageOptions {
  /** The address to draw for a stored `src`, or null when it is not one of the owner's uploads. */
  display: (src: string) => string | null;
}

/** Alt text as it can sit inside `![...]`: one line, no square brackets. */
export function cleanAlt(alt: string): string {
  return alt
    .replace(/[[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export const BodyImage = Node.create<BodyImageOptions>({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { display: () => null };
  },

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-body-src") ?? "",
        renderHTML: () => ({}),
      },
      alt: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-body-alt") ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  // Only the editor's own markup is read back (a cut and paste inside the body). An <img> pasted
  // from another page is not an image of this post.
  parseHTML() {
    return [{ tag: "[data-body-src]" }];
  },

  renderHTML({ node }) {
    const src = text(node.attrs.src);
    const alt = text(node.attrs.alt);
    const shown = this.options.display(src);
    const data = { "data-body-src": src, "data-body-alt": alt };
    if (shown === null) {
      return ["span", { ...data, "data-body-image": "missing" }, alt === "" ? "Image" : alt];
    }
    return ["img", { ...data, "data-body-image": "", src: shown, alt, loading: "lazy" }];
  },

  markdownTokenName: "image",

  parseMarkdown(token) {
    return { type: "image", attrs: { src: text(token.href), alt: text(token.text) } };
  },

  renderMarkdown(node) {
    return `![${text(node.attrs?.alt)}](${text(node.attrs?.src)})`;
  },
});
