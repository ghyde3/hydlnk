"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace-context";
import { MiniPhonePreview } from "./mini-phone";

/**
 * The mini phone wired to the workspace (M7-09): it draws `shownForm` (the draft, or the page in
 * the theme being previewed), a tap in the sheet goes to `onPreviewTap`, and choosing "Preview" in
 * a theme card's menu opens the sheet at once with the "Previewing Paper" bar. The shell mounts it
 * below 760px through `workspace-mini-phone-slot.tsx`.
 */
export function ConnectedMiniPhone() {
  const { shownForm, pageId, chrome, onPreviewTap, preview, site } = useWorkspace();
  const [open, setOpen] = useState(false);
  const themeView = preview.view;
  const previewing = themeView !== null;

  // A theme preview opens the sheet when it starts and closes it when it ends (an Apply, a Back to
  // my style, or an edit that ended it): the page on show and the sheet never disagree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows an external state change
    setOpen(previewing);
  }, [previewing]);

  return (
    <MiniPhonePreview
      doc={shownForm}
      pageId={pageId}
      chrome={chrome}
      open={open}
      onOpenChange={setOpen}
      onTap={onPreviewTap}
      themePreview={themeView}
      view={site.preview}
      onNavigate={(href) => {
        const id = site.hrefToId(href);
        if (id !== null) site.select(id);
      }}
    />
  );
}
