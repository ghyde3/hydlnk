// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockDefaults, emptyDraft, type Block } from "@/lib/document";

/**
 * 1b1-17: the saver is seeded with Home's loaded blocks only when the load was not repaired. A
 * repaired load (the stored entry was corrupt) must still write its repaired blocks on the first save.
 */

const createDraftSaver = vi.fn((..._args: unknown[]) => async () => ({ kind: "ok" as const }));
vi.mock("@/lib/editor/save-client", () => ({
  createDraftSaver: (...args: unknown[]) => createDraftSaver(...args),
}));

const { useAutosave } = await import("@/components/editor/use-autosave");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const blocks = [{ ...blockDefaults.link(), id: "lnk-aaaaaaaa" } as Block];
const draft = { ...emptyDraft("mara"), blocks };
const home = { entryId: "e", rev: 3 };

function Probe(props: { repaired: boolean }) {
  useAutosave({ pageId: "p", draft, initialRevKey: null, home, repaired: props.repaired });
  return null;
}
const mount = (repaired: boolean) => {
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { repaired })));
  act(() => root.unmount());
};

beforeEach(() => createDraftSaver.mockClear());

describe("useAutosave seeding", () => {
  it("seeds the saver with the loaded blocks when the load was clean", () => {
    mount(false);
    expect(createDraftSaver.mock.calls[0]![2]).toEqual(blocks);
  });
  it("does not seed it when the load was repaired", () => {
    mount(true);
    expect(createDraftSaver.mock.calls[0]![2]).toBeUndefined();
  });
});
