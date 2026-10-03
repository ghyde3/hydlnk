import type { Block } from "@/lib/document";
import {
  DEFAULT_PRESET,
  TRY_MAX_BLOCKS,
  blockName,
  makeBlock,
  presetBlocks,
  type TryBlockKind,
  type TryPageState,
  type TryPreset,
} from "./sample-page";
import {
  ACCENT_LABELS,
  BACKGROUND_LABELS,
  FONT_PAIRS,
  SHAPE_LABELS,
  THEME_STYLE,
  tryTheme,
  type AccentId,
  type BackgroundId,
  type FontPairId,
  type ShapeId,
  type TryThemeId,
} from "./themes";

/**
 * The builder's state and what changes it. A plain reducer, so every move (a theme tap, a swatch,
 * adding, moving or removing a block) is unit tested without a browser. `status` is the sentence
 * the page announces to screen readers after each change.
 */

export interface TryState extends TryPageState {
  preset: TryPreset;
  /** Counts blocks ever added, so ids stay unique after a remove. */
  serial: number;
  /** The block just added, so the preview can scroll to it. */
  lastAddedId: string | null;
  status: string;
}

export type TryAction =
  | { type: "theme"; id: TryThemeId }
  | { type: "accent"; value: AccentId | null }
  | { type: "fonts"; value: FontPairId }
  | { type: "shape"; value: ShapeId }
  | { type: "background"; value: BackgroundId }
  | { type: "name"; value: string }
  | { type: "add"; kind: TryBlockKind }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; direction: -1 | 1 }
  | { type: "reset" };

export function initialTryState(preset: TryPreset = {}): TryState {
  const blocks = presetBlocks(preset);
  return {
    preset,
    themeId: preset.theme ?? DEFAULT_PRESET.theme,
    style: THEME_STYLE,
    name: "",
    blocks,
    serial: blocks.length,
    lastAddedId: null,
    status: "",
  };
}

function countOf(blocks: readonly Block[], kind: TryBlockKind): number {
  return blocks.filter((block) => block.type === kind).length;
}

function blocksLabel(count: number): string {
  return count === 1 ? "1 block" : `${count} blocks`;
}

export function tryReducer(state: TryState, action: TryAction): TryState {
  switch (action.type) {
    case "theme":
      // A new theme starts clean, so what was tweaked on the last one never fights the new colors.
      return {
        ...state,
        themeId: action.id,
        style: THEME_STYLE,
        status: `${tryTheme(action.id).name} theme applied.`,
      };
    case "accent":
      return {
        ...state,
        style: { ...state.style, accent: action.value },
        status: `Accent color: ${action.value ? ACCENT_LABELS[action.value] : "theme default"}.`,
      };
    case "fonts":
      return {
        ...state,
        style: { ...state.style, fonts: action.value },
        status: `Fonts: ${action.value === "theme" ? "theme default" : FONT_PAIRS[action.value].label}.`,
      };
    case "shape":
      return {
        ...state,
        style: { ...state.style, shape: action.value },
        status: `Buttons: ${action.value === "theme" ? "theme default" : SHAPE_LABELS[action.value]}.`,
      };
    case "background":
      return {
        ...state,
        style: { ...state.style, background: action.value },
        status: `Background: ${action.value === "theme" ? "theme default" : BACKGROUND_LABELS[action.value]}.`,
      };
    case "name":
      return { ...state, name: action.value.slice(0, 40) };
    case "add": {
      if (state.blocks.length >= TRY_MAX_BLOCKS) {
        return {
          ...state,
          lastAddedId: null,
          status: `The demo page holds ${TRY_MAX_BLOCKS} blocks. Remove one to add another.`,
        };
      }
      const serial = state.serial + 1;
      const block = makeBlock(action.kind, serial, {
        variant: countOf(state.blocks, action.kind),
        socials: state.preset.socials,
        linkLabels: state.preset.linkLabels,
      });
      const blocks = [...state.blocks, block];
      return {
        ...state,
        blocks,
        serial,
        lastAddedId: block.id,
        status: `Added ${blockName(block)}. ${blocksLabel(blocks.length)} on the page.${
          block.type === "image" ? " It shows a placeholder here. You upload your own photo in the editor." : ""
        }`,
      };
    }
    case "remove": {
      const target = state.blocks.find((block) => block.id === action.id);
      if (!target) return state;
      const blocks = state.blocks.filter((block) => block.id !== action.id);
      return {
        ...state,
        blocks,
        lastAddedId: null,
        status: `Removed ${blockName(target)}. ${blocksLabel(blocks.length)} left.`,
      };
    }
    case "move": {
      const from = state.blocks.findIndex((block) => block.id === action.id);
      if (from === -1) return state;
      const to = from + action.direction;
      const name = blockName(state.blocks[from]!);
      if (to < 0 || to >= state.blocks.length) {
        return {
          ...state,
          lastAddedId: null,
          status: `${name} is already ${to < 0 ? "first" : "last"}.`,
        };
      }
      const blocks = [...state.blocks];
      const [moved] = blocks.splice(from, 1);
      blocks.splice(to, 0, moved!);
      return {
        ...state,
        blocks,
        lastAddedId: null,
        status: `Moved ${name} ${action.direction < 0 ? "up" : "down"}. It is now ${to + 1} of ${blocks.length}.`,
      };
    }
    case "reset":
      return { ...initialTryState(state.preset), name: state.name, status: "Started over." };
  }
}
