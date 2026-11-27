"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Field, FORM_BUTTON, controlClass } from "@/components/blocks/field";
import { ImageUploadControl } from "@/components/editor/image-upload-control";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";
import { isHttpUrl, type ImageRef } from "@/lib/document";
import { mediaOrigin, mediaUrl, storageUrl } from "@/lib/media/url";
import { mediaPathOf } from "@/lib/themes/bg-image";
import { bodyExtensions } from "./extensions";
import { cleanAlt } from "./image-node";
import { canEditRich, fromMarkdown, toMarkdown } from "./markdown";
import { SourceBox } from "./source-box";
import { BodyToolbar, EMPTY_MODEL, readModel } from "./toolbar";

/**
 * The post body (M16-13): Markdown, edited in a Tiptap instance of its own (`extensions.ts`), or in
 * the plain Markdown box when the rich editor could not hold the body without loss (`markdown.ts`).
 * Which of the two is decided once, when the editor mounts with a body; it does not flip while the
 * person types.
 *
 * The stored body is never rewritten by opening a post: `onChange` fires only for a change the
 * person made (a key, a paste, a drop, a toolbar button), never for the editor's own housekeeping
 * on mount. What it hands over is the document as Markdown, with no trailing blank lines.
 *
 * HYDLNK UI tokens only: this is editor chrome, not the tenant page. An image is drawn only when it
 * is one of the owner's uploads, from the `/media` route; any other address shows its alt text.
 */

const CONTENT =
  "min-h-[280px] w-full min-w-0 rounded-md border border-line-3 bg-surface px-3 py-3 text-base leading-relaxed text-ink [overflow-wrap:anywhere] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass " +
  "[&_p]:my-2 [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-[22px] [&_h2]:leading-tight [&_h2]:font-bold " +
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-bold [&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:text-base [&_h4]:font-bold " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line-3 [&_blockquote]:pl-3 [&_blockquote]:text-text-2 " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-page [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-sm " +
  "[&_code]:font-mono [&_code]:text-[0.9em] [&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-line-2 " +
  "[&_a]:text-ink [&_a]:underline [&_img]:my-2 [&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md " +
  "[&_[data-body-image=missing]]:inline-block [&_[data-body-image=missing]]:rounded-sm [&_[data-body-image=missing]]:bg-track [&_[data-body-image=missing]]:px-2 [&_[data-body-image=missing]]:py-1 [&_[data-body-image=missing]]:text-xs [&_[data-body-image=missing]]:text-text-2";

/** The address the editor may draw for a stored image: only the owner's own upload, in its stored form. */
export function displaySrc(src: string, ownerId: string): string | null {
  const path = mediaPathOf(src, mediaOrigin());
  if (path === null || !path.startsWith(`${ownerId}/`) || storageUrl(path) !== src) return null;
  return mediaUrl(path);
}

export interface BodyEditorProps {
  /** The stored Markdown the editor opens with. Later values are ignored: remount (a new `key`) to load another body. */
  initial: string;
  onChange: (markdown: string) => void;
  disabled: boolean;
  ownerId: string;
  /** The id of the visible "Body" label. */
  labelledBy: string;
}

export function BodyEditor(props: BodyEditorProps) {
  // Decided once per mount: a body that fails the loss guard is edited as plain Markdown.
  const [rich] = useState(() => canEditRich(props.initial));
  const [source, setSource] = useState(props.initial);
  if (!rich) {
    return (
      <SourceBox
        value={source}
        disabled={props.disabled}
        labelledBy={props.labelledBy}
        onChange={(next) => {
          setSource(next);
          props.onChange(next);
        }}
      />
    );
  }
  return <RichBody {...props} />;
}

function RichBody({ initial, onChange, disabled, ownerId, labelledBy }: BodyEditorProps) {
  const [panel, setPanel] = useState<"link" | "image" | null>(null);
  const [href, setHref] = useState("");
  const [hrefError, setHrefError] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const panelId = useId();
  /** Set by the first thing the person does in the editor; nothing is handed over before it. */
  const touched = useRef(false);
  const emit = useRef(onChange);
  useEffect(() => {
    emit.current = onChange;
  }, [onChange]);

  const extensions = useMemo(
    () => bodyExtensions({ display: (src) => displaySrc(src, ownerId) }),
    [ownerId],
  );
  // The document `canEditRich` checked, from the same bounded lexer (never marked's), built once.
  const [content] = useState(() => fromMarkdown(initial));
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: CONTENT,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelledBy,
        "data-testid": POST_TEST_IDS.body,
      },
    },
    onUpdate: ({ editor: current }) => {
      if (!touched.current) return;
      // Written by the same serializer the loss guard checks with (`toMarkdown`), which escapes a
      // line typed like block syntax ("# text"), so what is saved reopens here as it was typed.
      emit.current(toMarkdown(current.getJSON()).replace(/\n+$/, ""));
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const model =
    useEditorState({
      editor,
      selector: ({ editor: current }) => (current ? readModel(current) : EMPTY_MODEL),
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    }) ?? EMPTY_MODEL;

  const touch = () => {
    touched.current = true;
  };

  const openLink = () => {
    if (!editor) return;
    setHref(
      typeof editor.getAttributes("link").href === "string"
        ? editor.getAttributes("link").href
        : "",
    );
    setHrefError(null);
    setPanel(panel === "link" ? null : "link");
  };

  const applyLink = () => {
    if (!editor) return;
    const url = href.trim();
    if (!isHttpUrl(url)) {
      setHrefError("Use a full address that starts with https:// or http://.");
      return;
    }
    touch();
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({
        type: "text",
        text: url,
        marks: [{ type: "link", attrs: { href: url } }],
      });
    } else {
      chain.extendMarkRange("link").setLink({ href: url });
    }
    chain.run();
    setPanel(null);
  };

  const removeLink = () => {
    if (!editor) return;
    touch();
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setPanel(null);
  };

  const insertImage = (ref: ImageRef | null) => {
    if (!editor || ref === null) return;
    touch();
    editor
      .chain()
      .focus()
      .insertContent({ type: "image", attrs: { src: storageUrl(ref.path), alt: cleanAlt(alt) } })
      .run();
    setAlt("");
    setPanel(null);
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      onKeyDownCapture={touch}
      onPointerDownCapture={touch}
      onPasteCapture={touch}
      onDropCapture={touch}
      onBeforeInputCapture={touch}
      onCompositionStartCapture={touch}
    >
      <BodyToolbar
        editor={editor}
        model={model}
        disabled={disabled}
        panel={panel}
        onLink={openLink}
        onImage={() => setPanel(panel === "image" ? null : "image")}
      />
      {panel === "link" ? (
        <div
          id={panelId}
          data-body-panel="link"
          className="flex flex-col gap-2 rounded-md border border-line bg-page p-3"
        >
          <Field label="Link address" error={hrefError}>
            {(control) => (
              <input
                {...control}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-field="post-link-href"
                value={href}
                placeholder="https://"
                onChange={(event) => setHref(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                }}
                className={controlClass(hrefError !== null)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={applyLink} className={FORM_BUTTON}>
              Apply link
            </button>
            {model.link ? (
              <button type="button" onClick={removeLink} className={FORM_BUTTON}>
                Remove link
              </button>
            ) : null}
            <button type="button" onClick={() => setPanel(null)} className={FORM_BUTTON}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {panel === "image" ? (
        <div
          data-body-panel="image"
          className="flex flex-col gap-3 rounded-md border border-line bg-page p-3"
        >
          <Field
            label="Describe the image"
            hint="Read aloud by screen readers. Add it before you upload."
          >
            {(control) => (
              <input
                {...control}
                type="text"
                data-field="post-image-alt"
                value={alt}
                maxLength={200}
                onChange={(event) => setAlt(event.target.value)}
                className={controlClass(false)}
              />
            )}
          </Field>
          <ImageUploadControl value={null} kind="content" label="image" onChange={insertImage} />
          <button
            type="button"
            onClick={() => setPanel(null)}
            className={`${FORM_BUTTON} self-start`}
          >
            Cancel
          </button>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
