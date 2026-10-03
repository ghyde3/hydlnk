// @vitest-environment jsdom
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UrlField } from "@/components/blocks/url-field";
import { BLOCKED_FIELD_MESSAGE } from "@/lib/blocklist/messages";

/**
 * M5-03: the URL field shows the blocked-site message for as long as the parent passes it, even for
 * a well-formed, edited address (that is exactly what a blocked link is). Any other Publish message
 * still goes away as soon as the edited value validates, as before (M2-15).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Harness({ message, initial }: { message: string; initial: string }) {
  const [value, setValue] = useState(initial);
  return createElement(UrlField, { value, onChange: setValue, error: message });
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("M5-03 UrlField and the blocked-site message", () => {
  it("keeps the blocked message under a valid address after the field was edited", () => {
    act(() =>
      root.render(
        createElement(Harness, {
          message: BLOCKED_FIELD_MESSAGE,
          initial: "https://blocked.example/x",
        }),
      ),
    );
    const input = host.querySelector("input")!;
    expect(host.textContent).toContain(BLOCKED_FIELD_MESSAGE);
    type(input, "https://blocked.example/y");
    expect(input.value).toBe("https://blocked.example/y");
    expect(host.textContent).toContain(BLOCKED_FIELD_MESSAGE);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("any other Publish message still clears once the edited value validates", () => {
    const message = "That image isn’t in your uploads. Upload it again.";
    act(() => root.render(createElement(Harness, { message, initial: "nope" })));
    const input = host.querySelector("input")!;
    expect(host.textContent).toContain(message);
    type(input, "https://ok.example/");
    expect(host.textContent).not.toContain(message);
  });
});
