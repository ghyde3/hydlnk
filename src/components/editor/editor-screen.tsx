"use client";

import { useEffect, useMemo } from "react";
import { PagesCard } from "@/components/site/pages-card";
import { SiteTemplatesCard } from "@/components/site/site-templates-card";
import { SubPageEdit } from "@/components/site/sub-page-edit";
import { PageTokensProvider } from "@/components/themes";
import { StartFromTemplate } from "@/components/templates";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { blockedFieldErrors } from "@/lib/blocklist/fields";
import { AddBlockCard } from "./add-block-card";
import { BannerCard } from "./banner-card";
import { BlockList } from "./block-list";
import { focusProfilePart } from "./preview-taps";
import { ProfileCard } from "./profile-card";

/**
 * The Edit tab (M7-02): the profile card, the "Add a block" card and the block list. Everything
 * else the editor used to draw itself (the header, the notices, the live preview, the toasts, the
 * share card, Publish) is the workspace's: the draft, its history and its one autosave queue live
 * in the workspace's provider (src/components/workspace), and this tab only reads and edits them
 * through `useWorkspace()`.
 */
export function EditTab() {
  const {
    state,
    dispatch,
    editDraft,
    form,
    autosave,
    templateThemes,
    profileTap,
    clearProfileTap,
    site,
  } = useWorkspace();
  const { draft } = state;

  // The URL fields the database refused as links to blocked sites (M5-03), shown under those fields
  // beside the Publish errors. They are derived from the draft as it is now, so changing the URL
  // clears the error at once; the save that follows takes the status back to "Saved".
  const blocked = autosave.blocked;
  const blockedErrors = useMemo(() => blockedFieldErrors(draft, blocked), [draft, blocked]);
  const listErrors = useMemo(
    () =>
      blockedErrors.length === 0 ? state.publishErrors : [...state.publishErrors, ...blockedErrors],
    [state.publishErrors, blockedErrors],
  );
  const nameError =
    state.publishErrors.find((error) => error.field === "profile.name")?.message ?? null;
  // The logo's own Publish error (M9-24: a missing, foreign or vanished upload), under its control.
  const logoError =
    state.publishErrors.find(
      (error) => error.blockId === null && error.field.startsWith("profile.logo"),
    )?.message ?? null;
  // The banner's errors (M9-23): the gate's own and the blocklist's, under their exact fields.
  const bannerErrors = useMemo(
    () =>
      listErrors.filter(
        (error) =>
          error.blockId === "banner" ||
          (error.blockId === null && error.field.startsWith("banner")),
      ),
    [listErrors],
  );

  // A tap on the avatar, name or bio in the preview (M6-03): the workspace asks for the field, and
  // it is focused once this tab is on screen (a tap on another tab goes to Edit first).
  const tapNonce = profileTap?.nonce ?? null;
  const tapPart = profileTap?.part ?? null;
  useEffect(() => {
    if (tapNonce === null || tapPart === null) return;
    focusProfilePart(tapPart);
    clearProfileTap(tapNonce);
  }, [tapNonce, tapPart, clearProfileTap]);

  // The pages of the site (M11-08): the list is always first; a sub-page replaces Home's cards.
  if (!site.isHome) {
    return (
      <>
        <PagesCard />
        <SubPageEdit />
      </>
    );
  }

  return (
    <>
      <PagesCard />
      {draft.blocks.length === 0 ? <SiteTemplatesCard /> : null}
      <ProfileCard
        name={draft.profile.name}
        bio={draft.profile.bio}
        photo={draft.profile.photo}
        options={draft.profile}
        nameError={nameError}
        focus={state.focus}
        dispatch={dispatch}
        logo={draft.profile.logo ?? null}
        logoPlacement={draft.profile.logoPlacement}
        logoError={logoError}
        onEdit={editDraft}
      />
      <BannerCard
        banner={draft.banner}
        errors={bannerErrors}
        focus={state.focus}
        edit={editDraft}
        dispatch={dispatch}
      />
      <AddBlockCard
        blockCount={draft.blocks.length}
        dispatch={dispatch}
        footer={<StartFromTemplate draft={draft} themes={templateThemes} dispatch={dispatch} />}
      />
      <PageTokensProvider tokens={form.tokens}>
        <BlockList
          blocks={draft.blocks}
          expandedId={state.expandedId}
          errors={listErrors}
          focus={state.focus}
          announcement={state.announcement}
          announceSeq={state.announceSeq}
          dispatch={dispatch}
        />
      </PageTokensProvider>
    </>
  );
}
