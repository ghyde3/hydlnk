/**
 * The mini phone's measures (M7-09), in one place so the workspace's own spacing can follow them:
 * the content's bottom padding clears the phone, and the toasts end before its column.
 *
 * From the bottom of a phone screen: the app's tab bar (a 56px bar and its 1px top border, plus the
 * safe-area inset), a 12px gap, then the mini phone, 104px tall; it sits 16px from the right edge.
 */
export const TAB_BAR_HEIGHT = 57;
export const MINI_PHONE_WIDTH = 48;
export const MINI_PHONE_HEIGHT = 104;
/** The round form while a text field has focus: 44x44, the smallest touch target. */
export const MINI_PHONE_ROUND = 44;
export const MINI_PHONE_RIGHT = 16;
export const MINI_PHONE_GAP_ABOVE_TAB_BAR = 12;

/** The width the page is laid out at inside the thumbnail: a phone screen. */
export const THUMBNAIL_PAGE_WIDTH = 390;
/** How much of its size the page is drawn at: the thumbnail box (the button inside its 1px border) over the page width, about 12%. */
export const THUMBNAIL_SCALE = (MINI_PHONE_WIDTH - 2) / THUMBNAIL_PAGE_WIDTH;

/** `bottom` of the mini phone: above the tab bar and its safe-area inset. */
export const MINI_PHONE_BOTTOM = `calc(${TAB_BAR_HEIGHT + MINI_PHONE_GAP_ABOVE_TAB_BAR}px + env(safe-area-inset-bottom))`;

/**
 * Bottom padding the workspace's content column needs below 760px (plus the safe-area inset) so
 * its last row and the "Add a block" card scroll fully above the tab bar and the mini phone:
 * 57 + 12 + 104 + 12 = 185px. The app's <main> pads `APP_MAIN_BOTTOM_PADDING` of it, so the
 * workspace's tab panel adds `WORKSPACE_PANEL_BOTTOM_PADDING` (101px, `pb-[101px]`).
 */
export const MINI_PHONE_CONTENT_CLEARANCE =
  TAB_BAR_HEIGHT + MINI_PHONE_GAP_ABOVE_TAB_BAR + MINI_PHONE_HEIGHT + 12;
/** The bottom padding the app shell's <main> already gives every phone screen (`pb-[calc(84px+...)]`). */
export const APP_MAIN_BOTTOM_PADDING = 84;
export const WORKSPACE_PANEL_BOTTOM_PADDING =
  MINI_PHONE_CONTENT_CLEARANCE - APP_MAIN_BOTTOM_PADDING;

/**
 * The `right` offset of the fixed toasts below 760px: they end 8px to the left of the mini phone's
 * column (16 + 48 + 8 = 72px), so none overlaps its box and every Undo and link stays tappable.
 * The three toasts (`UndoToast`, `TemplateToast`, `PublishedToast`) and the Themes card's message
 * carry it as the class `right-[72px]` (a Tailwind class cannot read this constant; the static
 * test tests/unit/m7-workspace-static.test.ts pins both).
 */
export const MINI_PHONE_TOAST_RIGHT = MINI_PHONE_RIGHT + MINI_PHONE_WIDTH + 8;

/** Text controls: the fields that open the soft keyboard. Checkboxes, files and buttons do not. */
const NON_TEXT_INPUT = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** An `input`, `textarea` or `select` that takes text (the soft keyboard opens for it). */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUT.has(target.type);
}
