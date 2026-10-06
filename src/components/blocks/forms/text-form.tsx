"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { TextEditorProps } from "./text-editor/text-editor";
import { OverrideControls } from "./override-controls";
import type { BlockFormProps } from "./types";

/**
 * The text block's form (M2-16, M6-30, M9-12): the rich text editor, then the block's own style.
 *
 * The rich text editor is loaded by a dynamic import the first time a text block is
 * expanded, so the editor screen's first load carries none of it, and a page with no text block
 * open never fetches it. The module is fetched once and kept. Until it arrives the field shows a
 * placeholder that can take the focus: a block that was just added asks for focus in its first
 * field, and the editor puts the caret in itself when it appears if that request landed on the
 * placeholder.
 *
 * This is the only file outside `text-editor/` that names the editor, and only through the
 * `import()` below; the tenant renderer, the share page and the marketing site never reach it.
 */

type EditorComponent = ComponentType<TextEditorProps>;

export function TextForm({ block, onChange, onSessionChange, onSessionEnd, errors }: BlockFormProps) {
  if (block.type !== "text") return null;
  // The block's own style (M6-46) sits under its text, links and formatting, in its own group.
  return (
    <div className="flex flex-col gap-3">
      <TextEditorLoader
        block={block}
        onChange={onChange}
        onSessionChange={onSessionChange}
        onSessionEnd={onSessionEnd}
        errors={errors}
      />
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}

function TextEditorLoader(props: TextEditorProps) {
  const [Editor, setEditor] = useState<EditorComponent | null>(null);
  const [failed, setFailed] = useState(0);
  const [wantsFocus, setWantsFocus] = useState(false);

  useEffect(() => {
    let alive = true;
    import("./text-editor/text-editor").then(
      (module) => {
        if (alive) setEditor(() => module.default);
      },
      () => {
        if (alive) setFailed((count) => count + 1);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (Editor) return <Editor {...props} autoFocus={wantsFocus} />;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">Text</span>
      {/* The first field of a new block takes the focus here, and the editor takes it from here. */}
      <div
        data-text-editor-first=""
        tabIndex={0}
        role="status"
        aria-busy={failed === 0}
        // A failed Publish asks for the first invalid control of the block: until the editor is
        // here, this is it, and the editor then moves the focus to the field or the link at fault.
        aria-invalid={props.errors.length > 0 ? true : undefined}
        onFocus={() => setWantsFocus(true)}
        className="flex min-h-28 w-full min-w-0 rounded-md border border-line-3 bg-surface px-3 py-2.5 text-sm text-text-2"
      >
        {failed === 0 ? "Loading the text editor…" : "The text editor could not be loaded. Reload the page to try again."}
      </div>
    </div>
  );
}
