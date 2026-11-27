// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCK_FORMS } from "@/components/blocks/forms";
import { blockRowSummary as blockSummary } from "@/components/blocks/summary";
import {
  WorkspaceContextProvider,
  type WorkspaceValue,
} from "@/components/workspace/workspace-context";
import { blockDefaults, type Block, type FormBlock, type PublishError } from "@/lib/document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M17-07: the form block's edit panel and its row. Kind, heading, description, "Ask for a name"
 * (sign-up only), the three required texts, "Email me each message" (contact only, naming the
 * account's address); switching kind swaps the default words only; Publish errors on their fields.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function mount(initial: Block, errors: PublishError[] = [], ownerEmail?: string) {
  const latest: { block: Block } = { block: initial };
  function Harness() {
    const [block, setBlock] = useState<Block>(initial);
    latest.block = block;
    const form = createElement(BLOCK_FORMS.form, {
      block,
      errors,
      onChange: setBlock,
      onImage: () => undefined,
    });
    return ownerEmail
      ? createElement(
          WorkspaceContextProvider,
          { value: { ownerEmail } as unknown as WorkspaceValue },
          form,
        )
      : form;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, latest };
}

const field = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`);
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const choose = (select: HTMLSelectElement, value: string) =>
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("M17-07 the form block's edit panel", () => {
  it("a sign-up shows kind, heading, description, Ask for a name and the three texts, and no notify switch", () => {
    const { host } = mount(blockDefaults.form() as FormBlock);
    for (const name of [
      "kind",
      "heading",
      "description",
      "askName",
      "buttonLabel",
      "successMessage",
      "consent",
    ])
      expect(field(host, name), name).not.toBeNull();
    expect(field(host, "notify")).toBeNull();
    for (const input of host.querySelectorAll("input"))
      expect(input.className).toMatch(/text-base|16px/);
  });

  it("every text field has its own counter, in code points, that follows what is typed", () => {
    const { host } = mount(blockDefaults.form() as FormBlock);
    const counterOf = (name: string) =>
      field(host, name)!.closest("label, div")!.parentElement!.textContent ?? "";
    for (const [name, max] of [
      ["heading", 80],
      ["description", 200],
      ["buttonLabel", 30],
      ["successMessage", 160],
      ["consent", 200],
    ] as const) {
      const value = (field(host, name) as HTMLInputElement).value;
      expect(counterOf(name), name).toContain(`${[...value].length} / ${max}`);
    }
    type(field(host, "heading") as HTMLInputElement, "Écrire ✉");
    expect(counterOf("heading")).toContain("8 / 80");
  });

  it("switching to Contact swaps the default words, hides Ask for a name and shows the notify switch", () => {
    const { host, latest } = mount(blockDefaults.form() as FormBlock, [], "owner@example.test");
    choose(field(host, "kind") as HTMLSelectElement, "contact");
    expect(latest.block).toMatchObject({
      kind: "contact",
      buttonLabel: "Send",
      successMessage: "Thanks. Your message was sent.",
    });
    expect(field(host, "askName")).toBeNull();
    const notify = field(host, "notify")!;
    expect(notify.closest("[data-testid]")!.textContent).toContain(
      "Messages go to owner@example.test, your sign-in address.",
    );
    act(() => (notify as unknown as HTMLButtonElement).click());
    expect((latest.block as FormBlock).notify).toBe(true);
  });

  it("a button label the owner typed survives a kind switch", () => {
    const { host, latest } = mount(blockDefaults.form() as FormBlock);
    type(field(host, "buttonLabel") as HTMLInputElement, "Join");
    choose(field(host, "kind") as HTMLSelectElement, "contact");
    expect(latest.block).toMatchObject({
      buttonLabel: "Join",
      successMessage: "Thanks. Your message was sent.",
    });
  });

  it("an emptied heading is dropped from the block; Ask for a name toggles", () => {
    const { host, latest } = mount({
      ...(blockDefaults.form() as FormBlock),
      heading: "News",
    } as Block);
    type(field(host, "heading") as HTMLInputElement, "");
    expect(latest.block).not.toHaveProperty("heading");
    act(() => (field(host, "askName") as unknown as HTMLButtonElement).click());
    expect((latest.block as FormBlock).askName).toBe(true);
  });

  it("Publish errors appear on their own fields", () => {
    const block = { ...(blockDefaults.form() as FormBlock), buttonLabel: "" } as FormBlock;
    const { host } = mount(block, [
      { blockId: block.id, field: "buttonLabel", message: "Add a button label." },
    ]);
    expect(host.textContent).toContain("Add a button label.");
  });

  it("the block row names the type and the heading, or the kind", () => {
    const signup = blockDefaults.form() as FormBlock;
    expect(blockSummary(signup)).toMatchObject({ typeLabel: "Form", title: "Sign-up form" });
    expect(blockSummary({ ...signup, kind: "contact", heading: "Write to me" })).toMatchObject({
      title: "Write to me",
      sub: "Contact form",
    });
  });
});
