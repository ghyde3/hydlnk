// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M1-29 / M1-30: what the Google button does with Google Identity Services and the Server Actions,
 * run in jsdom against a stubbed `window.google`. The Server Action side is in
 * auth-google-signin.test.ts; the browser side against a real page is in
 * tests/e2e/m5/google-signin.spec.ts. This file covers the one path no browser test can reach, a
 * successful sign-in, from the button's point of view.
 */

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: env }));
vi.mock("next/script", () => ({ default: () => null }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

type Result =
  | { kind: "ok" }
  | { kind: "error"; message: string }
  | { kind: "handle"; handle: string; status: string };
const prepareGoogleSignIn = vi.fn<() => Promise<{ ok: true; nonce: string } | { ok: false }>>();
const signInWithGoogle =
  vi.fn<(input: { credential: string; handle?: string }) => Promise<Result>>();
vi.mock("@/lib/auth/google-actions", () => ({
  prepareGoogleSignIn: () => prepareGoogleSignIn(),
  signInWithGoogle: (input: { credential: string; handle?: string }) => signInWithGoogle(input),
}));

const { GoogleButton } = await import("@/components/auth/google-button");
const { GOOGLE_FAILED_MESSAGE, GOOGLE_UNAVAILABLE_MESSAGE } =
  await import("@/lib/auth/google-shared");

type Callback = (response: { credential?: string }) => void;
const initialize =
  vi.fn<
    (config: {
      client_id: string;
      nonce: string;
      callback: Callback;
      ux_mode: string;
      auto_select: boolean;
    }) => void
  >();
const renderButton = vi.fn<(box: HTMLElement, options: Record<string, unknown>) => void>();

let container: HTMLDivElement;
let root: Root;
let nonces: number;

async function mount(node: ReactNode = createElement(GoogleButton)) {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {}); // let the nonce request settle
}
/** Google's iframe, pressed: hands the credential to the callback the page registered. */
async function pressGoogle(credential = "aaa.bbb.ccc") {
  await act(async () => {
    initialize.mock.lastCall![0].callback({ credential });
  });
  await act(async () => {});
}
const alertText = () => container.querySelector('p[role="alert"]')?.textContent ?? null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  nonces = 0;
  prepareGoogleSignIn.mockImplementation(async () => ({ ok: true, nonce: `hash-${++nonces}` }));
  signInWithGoogle.mockResolvedValue({ kind: "ok" });
  window.google = { accounts: { id: { initialize, renderButton } } };
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.google;
});

describe("starting up", () => {
  it("asks the server for a nonce, initialises Google with its hash in popup mode and draws the button", async () => {
    await mount();
    expect(prepareGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.lastCall![0]).toMatchObject({
      client_id: "test-client.apps.googleusercontent.com",
      nonce: "hash-1",
      ux_mode: "popup",
      auto_select: false,
    });
    expect(renderButton).toHaveBeenCalledTimes(1);
    const [, options] = renderButton.mock.lastCall!;
    expect(options).toMatchObject({
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
    });
    expect(options.width as number).toBeGreaterThanOrEqual(200);
    expect(options.width as number).toBeLessThanOrEqual(400);
    expect(container.querySelector("[inert]")).toBeNull(); // live: nothing covers it
  });

  it("says Google sign-in is unavailable when the server won't issue a nonce, and draws nothing", async () => {
    prepareGoogleSignIn.mockResolvedValue({ ok: false });
    await mount();
    expect(initialize).not.toHaveBeenCalled();
    expect(container.textContent).toContain(GOOGLE_UNAVAILABLE_MESSAGE);
  });

  it("says so when the nonce request itself fails (offline)", async () => {
    prepareGoogleSignIn.mockRejectedValue(new Error("offline"));
    await mount();
    expect(container.textContent).toContain(GOOGLE_UNAVAILABLE_MESSAGE);
  });
});

describe("a credential from Google", () => {
  it("success: sends it to the Server Action and loads '/' (the gate routes on), keeping the placeholder up", async () => {
    await mount();
    await pressGoogle("aaa.bbb.ccc");
    expect(signInWithGoogle).toHaveBeenCalledWith({ credential: "aaa.bbb.ccc", handle: undefined });
    expect(replace).toHaveBeenCalledWith("/");
    expect(container.textContent).toContain("Signing in…");
    // Nothing was spent that needs replacing: the page is leaving.
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(alertText()).toBeNull();
  });

  it("signup: carries the chosen handle", async () => {
    await mount(createElement(GoogleButton, { handle: "zq-gs-1" }));
    await pressGoogle();
    expect(signInWithGoogle).toHaveBeenCalledWith({ credential: "aaa.bbb.ccc", handle: "zq-gs-1" });
  });

  it("signup: sends the handle as it is NOW, not as it was when Google was initialised", async () => {
    await mount(createElement(GoogleButton, { handle: "zq-first" }));
    await mount(createElement(GoogleButton, { handle: "zq-second" }));
    await pressGoogle();
    expect(signInWithGoogle).toHaveBeenCalledWith({
      credential: "aaa.bbb.ccc",
      handle: "zq-second",
    });
  });

  it("ignores a credential-less callback", async () => {
    await mount();
    await act(async () => initialize.mock.lastCall![0].callback({}));
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it("is sent once even if Google calls back twice while it is in flight", async () => {
    let finish: (r: Result) => void = () => {};
    signInWithGoogle.mockReturnValue(new Promise<Result>((resolve) => (finish = resolve)));
    await mount();
    const { callback } = initialize.mock.lastCall![0];
    await act(async () => {
      callback({ credential: "aaa.bbb.ccc" });
      callback({ credential: "aaa.bbb.ccc" });
    });
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Signing in…");
    await act(async () => finish({ kind: "ok" }));
  });

  it("refused: shows the friendly message, does not navigate, and gets a NEW nonce for the next try", async () => {
    signInWithGoogle.mockResolvedValue({ kind: "error", message: GOOGLE_FAILED_MESSAGE });
    await mount();
    await pressGoogle();
    expect(alertText()).toBe(GOOGLE_FAILED_MESSAGE);
    expect(replace).not.toHaveBeenCalled();
    expect(prepareGoogleSignIn).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize.mock.lastCall![0].nonce).toBe("hash-2");
    expect(container.textContent).not.toContain("Signing in…");

    // The next try uses the callback registered with the new nonce and goes through.
    signInWithGoogle.mockResolvedValue({ kind: "ok" });
    await pressGoogle("ddd.eee.fff");
    expect(replace).toHaveBeenCalledWith("/");
    expect(alertText()).toBeNull();
  });

  it("a Server Action that throws (network) reads as a refusal, not a hang", async () => {
    signInWithGoogle.mockRejectedValue(new Error("network"));
    await mount();
    await pressGoogle();
    expect(alertText()).toBe(GOOGLE_FAILED_MESSAGE);
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("signup, handle refused after Google answered: hands the verdict to the form and also renews the nonce", async () => {
    signInWithGoogle.mockResolvedValue({ kind: "handle", handle: "mara", status: "taken" });
    const onHandleRefused = vi.fn();
    await mount(createElement(GoogleButton, { handle: "mara", onHandleRefused }));
    await pressGoogle();
    expect(onHandleRefused).toHaveBeenCalledWith({
      kind: "handle",
      handle: "mara",
      status: "taken",
    });
    expect(alertText()).toBeNull(); // the handle field says it, not a Google error
    expect(replace).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});

describe("blocked (signup, handle not usable yet)", () => {
  it("covers Google's button: the iframe is inert and a press goes to the handler, not to Google", async () => {
    const onBlockedPress = vi.fn();
    await mount(createElement(GoogleButton, { handle: "ab", blocked: true, onBlockedPress }));
    expect(container.querySelector("[inert]")).not.toBeNull();
    const cover = container.querySelector<HTMLButtonElement>('button[aria-disabled="true"]');
    expect(cover?.getAttribute("aria-label")).toBe("Continue with Google");
    await act(async () => cover!.click());
    expect(onBlockedPress).toHaveBeenCalledTimes(1);
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it("uncovers it when the handle becomes usable", async () => {
    await mount(createElement(GoogleButton, { handle: "ab", blocked: true }));
    await mount(createElement(GoogleButton, { handle: "zq-gs-1", blocked: false }));
    expect(container.querySelector("[inert]")).toBeNull();
    expect(container.querySelector('button[aria-disabled="true"]')).toBeNull();
  });

  it("disabled (not hydrated yet) covers it without a handler", async () => {
    await mount(createElement(GoogleButton, { disabled: true }));
    expect(container.querySelector("[inert]")).not.toBeNull();
    const cover = container.querySelector<HTMLButtonElement>('button[aria-disabled="true"]');
    await act(async () => cover!.click());
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });
});
