"use client";

import { AddBlockCard } from "@/components/editor/add-block-card";
import { BlockList } from "@/components/editor/block-list";
import { PageTokensProvider } from "@/components/themes";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { PageSettingsCard } from "./page-settings-card";

/**
 * What the Edit tab shows for a sub-page (M11-08): its settings, "Add a block" and the block list,
 * the same builder as Home's, fed the open sub-page's editor state. The profile, banner, theme and
 * the rest belong to the site (Home and the Design tab), so they are not here.
 */
export function SubPageEdit() {
  const { site, form } = useWorkspace();
  const editor = site.activeEditor;
  if (!editor) return null;
  return (
    <>
      <PageSettingsCard />
      <AddBlockCard blockCount={editor.draft.blocks.length} dispatch={site.dispatchActive} />
      <PageTokensProvider tokens={form.tokens}>
        <BlockList
          blocks={editor.draft.blocks}
          expandedId={editor.expandedId}
          errors={[...editor.publishErrors, ...site.activeBlockedErrors]}
          focus={editor.focus}
          announcement={editor.announcement}
          announceSeq={editor.announceSeq}
          dispatch={site.dispatchActive}
        />
      </PageTokensProvider>
    </>
  );
}
