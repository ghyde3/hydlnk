/**
 * The starter templates (M6-40): the static catalog and the pure functions that turn one into page
 * content. Client-safe; the server-only theme loader is `@/lib/templates/load`.
 */
export {
  TEMPLATES,
  TEMPLATE_IDS,
  TEMPLATE_THEME_IDS,
  templateById,
  type Template,
  type TemplateBlock,
  type TemplateId,
} from "./catalog";
export { applyTemplate, buildTemplateBlocks, templateNeedsConfirmation } from "./build";
