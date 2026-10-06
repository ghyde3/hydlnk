/**
 * The editor's seams with the other Milestone 2 areas, in one file: everything the editor imports
 * from the renderer, the block forms, the media route and the publish action comes through here,
 * so a change of path or signature touches one module.
 *
 *   renderer     PageRenderer (src/components/page/page-renderer.tsx)
 *   block forms  BLOCK_FORMS, BlockFormProps, blockRowSummary
 *   media        mediaUrl
 *   publishing   publishPage (a Server Action)
 */
import { EmbedFacade } from "@/components/page/embed-facade";
import { provideEmbedFacade } from "@/components/page/embed-slot";

// Every importer of this seam is a client module (the workspace, the preview, the block forms). Their
// previews draw embeds with the React facade, which mounts the same iframe the live page's script does.
provideEmbedFacade(EmbedFacade);

export { PageRenderer } from "@/components/page/page-renderer";
export type { PageChrome } from "@/components/page/page-renderer";
export { BLOCK_FORMS, type BlockFormProps } from "@/components/blocks/forms";
export { blockRowSummary } from "@/components/blocks/summary";
export { mediaUrl } from "@/lib/media/url";
export { publishPage } from "@/lib/publish/actions";
