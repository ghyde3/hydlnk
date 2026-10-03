/**
 * The template components (M6-40): the "Start from a template" button and dialog for the editor's
 * "Add a block" card, and the toast that follows an apply. The catalog and the pure apply live in
 * `@/lib/templates`; the apply itself is the editor reducer's `template/apply` action.
 */
export { replaceQuestion, TemplateDialog } from "./template-dialog";
export { StartFromTemplate } from "./start-from-template";
export { TEMPLATE_TOAST_MS, TemplateToast } from "./template-toast";
