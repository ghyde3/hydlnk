// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  MINI_PHONE_BOTTOM,
  MINI_PHONE_CONTENT_CLEARANCE,
  MINI_PHONE_GAP_ABOVE_TAB_BAR,
  MINI_PHONE_HEIGHT,
  MINI_PHONE_RIGHT,
  MINI_PHONE_ROUND,
  MINI_PHONE_TOAST_RIGHT,
  MINI_PHONE_WIDTH,
  TAB_BAR_HEIGHT,
  THUMBNAIL_SCALE,
  isTextField,
} from "@/components/workspace/mini-preview/measures";
import {
  DESKTOP_ROW_HEIGHT,
  PHONE_ROW_HEIGHT,
  PHONE_TABS_HEIGHT,
  PREVIEW_PIN_TOP,
  TOOLBAR_HEIGHT_VAR,
  measurePinned,
} from "@/components/workspace/toolbar/pinned-height";

describe("M7-09 the mini phone's measures", () => {
  it("M7-09 it is 48x104 (a 9:19.5 phone), 16px from the right edge and 12px above the tab bar", () => {
    expect(MINI_PHONE_WIDTH).toBe(48);
    expect(MINI_PHONE_HEIGHT).toBe(104);
    expect(MINI_PHONE_HEIGHT / MINI_PHONE_WIDTH).toBeCloseTo(19.5 / 9, 0);
    expect(MINI_PHONE_RIGHT).toBe(16);
    expect(MINI_PHONE_GAP_ABOVE_TAB_BAR).toBe(12);
    expect(MINI_PHONE_BOTTOM).toBe(`calc(${TAB_BAR_HEIGHT + 12}px + env(safe-area-inset-bottom))`);
    expect(MINI_PHONE_ROUND).toBe(44);
  });

  it("M7-09 the thumbnail draws the 390px page at about 12%", () => {
    expect(THUMBNAIL_SCALE).toBeGreaterThan(0.11);
    expect(THUMBNAIL_SCALE).toBeLessThan(0.13);
  });

  it("M7-09 the content clears the tab bar and the phone, and the toasts end 8px before its column", () => {
    expect(MINI_PHONE_CONTENT_CLEARANCE).toBeGreaterThanOrEqual(
      TAB_BAR_HEIGHT + MINI_PHONE_GAP_ABOVE_TAB_BAR + MINI_PHONE_HEIGHT,
    );
    expect(MINI_PHONE_TOAST_RIGHT).toBe(MINI_PHONE_RIGHT + MINI_PHONE_WIDTH + 8);
  });

  it("M7-09 isTextField: text inputs, textareas and selects, not buttons, checkboxes or files", () => {
    const make = (html: string) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      return host.firstElementChild;
    };
    expect(isTextField(make("<input>"))).toBe(true);
    expect(isTextField(make('<input type="url">'))).toBe(true);
    expect(isTextField(make("<textarea></textarea>"))).toBe(true);
    expect(isTextField(make("<select></select>"))).toBe(true);
    expect(isTextField(make('<input type="checkbox">'))).toBe(false);
    expect(isTextField(make('<input type="file">'))).toBe(false);
    expect(isTextField(make('<input type="color">'))).toBe(false);
    expect(isTextField(make("<button></button>"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("M7-05 what the toolbar pins", () => {
  it("M7-05 the rows: 56px at 1280px and up, 52px and 48px of tabs on a phone", () => {
    expect(DESKTOP_ROW_HEIGHT).toBe(56);
    expect(PHONE_ROW_HEIGHT + PHONE_TABS_HEIGHT).toBe(100);
  });

  it("M7-05 the preview column pins 16px under what is pinned, whatever its height", () => {
    expect(TOOLBAR_HEIGHT_VAR).toBe("--hl-toolbar-h");
    expect(PREVIEW_PIN_TOP).toBe("calc(var(--hl-toolbar-h, 56px) + 16px)");
  });

  it("M7-05 measurePinned adds up the pinned elements that are drawn and skips the hidden ones", () => {
    const root = document.createElement("div");
    const make = (height: number, drawn: boolean) => {
      const el = document.createElement("div");
      el.setAttribute("data-toolbar-pin", "");
      el.getClientRects = () =>
        drawn ? ([{}] as unknown as DOMRectList) : ([] as unknown as DOMRectList);
      el.getBoundingClientRect = () => ({ height }) as DOMRect;
      root.append(el);
    };
    make(52, true);
    make(48, true);
    make(96, false);
    expect(measurePinned(root)).toBe(100);
  });

  it("M7-05 a pinned element inside another drawn one is part of it, not more height", () => {
    const root = document.createElement("div");
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    for (const [element, height] of [
      [outer, 96],
      [inner, 48],
    ] as const) {
      element.setAttribute("data-toolbar-pin", "");
      element.getClientRects = () => [{}] as unknown as DOMRectList;
      element.getBoundingClientRect = () => ({ height }) as DOMRect;
    }
    outer.append(inner);
    root.append(outer);
    expect(measurePinned(root)).toBe(96);
  });
});
