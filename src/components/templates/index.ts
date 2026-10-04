/**
 * The template components (M6-40, M7-07, M7-08): the "Start from a template" button and dialog for
 * the editor's "Add a block" card (a live preview, what is inside and the style on every card, and
 * the one choice an apply asks), and the toast that follows an apply. The catalog and the pure apply
 * live in `@/lib/templates`; the apply itself is the editor reducer's `template/apply` action.
 */
export { TemplateDialog } from "./template-dialog";
export { TemplateChoice, templateStyleLabel } from "./template-choice";
export {
  PREVIEW_HEIGHT,
  PREVIEW_LEAD,
  PREVIEW_PAGE_WIDTH,
  TemplatePreview,
} from "./template-preview";
export { StartFromTemplate } from "./start-from-template";
export { TEMPLATE_TOAST_MS, TemplateToast } from "./template-toast";
