// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M5-15 / M5-16: the save banner shared by the Editor and Design, the inline publish notice, the
 * load-failure card and the copy rules (no "please", no exclamation marks, no "successfully").
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { SaveBanner, saveProblemFor } = await import("@/components/editor/save-banner");
const { InlineNotice } = await import("@/components/editor/inline-notice");
const { LoadFailure } = await import("@/components/editor/load-failure");
const messages = await import("@/lib/editor/messages");
const { SuspensionProvider } = await import("@/components/admin/suspension-context");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  refresh.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (node: Parameters<Root["render"]>[0]) => act(() => root.render(node));
/** createElement with children as arguments (the lint rule), for components whose props type wants `children`. */
const h = createElement as unknown as (
  type: unknown,
  props: object | null,
  ...children: unknown[]
) => Parameters<Root["render"]>[0];

describe("M5-15 saveProblemFor", () => {
  it("has a message for every failing status and none for the rest", () => {
    expect(saveProblemFor("conflict", false)?.message).toBe(messages.STALE_MESSAGE);
    expect(saveProblemFor("signed-out", false)).toEqual({
      kind: "signed-out",
      message: "You’ve been signed out. Sign in to keep editing.",
    });
    expect(saveProblemFor("invalid", false)?.message).toBe(messages.INVALID_MESSAGE);
    expect(saveProblemFor("error", false)?.message).toBe(
      "Couldn’t save. Your changes stay here and will retry.",
    );
    for (const status of ["idle", "pending", "saving", "saved", "too-large"] as const) {
      expect(saveProblemFor(status, false), status).toBeNull();
    }
  });

  it("a suspended owner's refused write says why; a signed-out session is still signed out", () => {
    expect(saveProblemFor("conflict", true)?.kind).toBe("suspended");
    expect(saveProblemFor("error", true)?.kind).toBe("suspended");
    expect(saveProblemFor("signed-out", true)?.kind).toBe("signed-out");
  });
});

describe("M5-15 the save banner", () => {
  it("signed out: role=alert, the sentence, and a Sign in link to /login in a new tab", () => {
    render(createElement(SaveBanner, { status: "signed-out" }));
    const banner = host.querySelector("[data-save-problem]")!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.getAttribute("data-save-problem")).toBe("signed-out");
    expect(banner.textContent).toContain("You’ve been signed out. Sign in to keep editing.");
    const link = banner.querySelector("a")!;
    expect(link.textContent).toBe("Sign in");
    expect(link.getAttribute("href")).toBe("/login");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(banner.querySelector("button")).toBeNull();
    expect(link.className).toContain("min-h-11");
  });

  it("conflict keeps its Reload button, and no other status has a link or button", () => {
    render(createElement(SaveBanner, { status: "conflict" }));
    expect(host.querySelector("button")?.textContent).toBe("Reload");
    expect(host.querySelector("a")).toBeNull();
    render(createElement(SaveBanner, { status: "error" }));
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
  });

  it("renders nothing while all is well", () => {
    for (const status of ["idle", "pending", "saving", "saved"] as const) {
      render(createElement(SaveBanner, { status }));
      expect(host.innerHTML, status).toBe("");
    }
  });

  it("inside a suspended account it says why the save was refused", () => {
    render(
      h(SuspensionProvider, { suspended: true }, createElement(SaveBanner, { status: "conflict" })),
    );
    expect(host.textContent).toContain("Your account is suspended");
    expect(host.querySelector("button")).toBeNull();
  });

  it("uses the DESIGN.md error tokens (text-bad, border-bad-line), not a literal colour", () => {
    render(createElement(SaveBanner, { status: "signed-out" }));
    const className = host.querySelector("[data-save-problem]")!.className;
    expect(className).toContain("text-bad");
    expect(className).toContain("border-bad-line");
  });
});

describe("M5-15 the inline notice", () => {
  it("shows the sentence with a Retry that calls back, and disables it while busy", () => {
    const onClick = vi.fn();
    render(
      h(
        InlineNotice,
        { kind: "publish", action: { label: "Retry", onClick } },
        "Couldn’t publish. Your draft is safe. Try again.",
      ),
    );
    const notice = host.querySelector("[data-inline-notice=publish]")!;
    expect(notice.getAttribute("role")).toBe("alert");
    const button = notice.querySelector("button")!;
    act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    render(
      h(
        InlineNotice,
        { kind: "publish", action: { label: "Retry", onClick, disabled: true } },
        "x",
      ),
    );
    expect(host.querySelector("button")!.disabled).toBe(true);
  });

  it("has no button when there is nothing to retry", () => {
    render(h(InlineNotice, { kind: "publish" }, "Couldn’t publish. Your account is suspended."));
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("M5-15 the load-failure card", () => {
  it("shows the one sentence and Retry, which asks the server to render again", () => {
    render(
      createElement(LoadFailure, { breadcrumb: "mara.hydlnk.com / main", title: "Main page" }),
    );
    expect(host.querySelector("h1")!.textContent).toBe("Main page");
    expect(host.querySelector("[data-testid=load-failure]")!.textContent).toBe(
      "We couldn’t load your page. Try again.",
    );
    expect(host.querySelector("[data-testid=load-failure]")!.getAttribute("role")).toBe("alert");
    const retry = host.querySelector("button")!;
    expect(retry.textContent).toBe("Retry");
    act(() => retry.click());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never prints anything but its own sentence (no error text can be passed in)", () => {
    render(createElement(LoadFailure, { breadcrumb: "x", title: "y" }));
    expect(host.textContent).not.toMatch(/error|exception|stack|supabase|fetch/i);
  });
});

describe("M5-15 copy rules for every sentence these states use", () => {
  const sentences = [
    messages.SIGNED_OUT_MESSAGE,
    messages.LOAD_FAILED_MESSAGE,
    messages.PUBLISH_FAILED_MESSAGE,
    messages.ALL_HIDDEN_MESSAGE,
    messages.THEMES_LOAD_FAILED_MESSAGE,
    messages.SAVED_THEMES_HINT,
    messages.THEME_DELETED_NOTICE,
    messages.SAVE_FAILED_MESSAGE,
    messages.STALE_MESSAGE,
  ];
  it("sentence case, no please, no exclamation marks, no successfully, typographic apostrophes", () => {
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toMatch(/please/i);
      expect(sentence, sentence).not.toContain("!");
      expect(sentence, sentence).not.toMatch(/successfully/i);
      expect(sentence, sentence).not.toContain("'");
      expect(sentence[0], sentence).toBe(sentence[0]!.toUpperCase());
    }
  });

  it("the sentences are exactly the ones in the acceptance steps", () => {
    expect(messages.SIGNED_OUT_MESSAGE).toBe("You’ve been signed out. Sign in to keep editing.");
    expect(messages.LOAD_FAILED_MESSAGE).toBe("We couldn’t load your page. Try again.");
    expect(messages.PUBLISH_FAILED_MESSAGE).toBe(
      "Couldn’t publish. Your draft is safe. Try again.",
    );
    expect(messages.ALL_HIDDEN_MESSAGE).toBe("All blocks are hidden. Turn one on to show it.");
    expect(messages.THEMES_LOAD_FAILED_MESSAGE).toBe("We couldn’t load your themes. Try again.");
    expect(messages.SAVED_THEMES_HINT).toBe(
      "Saved themes appear here. Use Save as theme to reuse this design on any page.",
    );
    expect(messages.THEME_DELETED_NOTICE).toBe(
      "The theme this page used was deleted. It now uses the default theme.",
    );
  });
});
