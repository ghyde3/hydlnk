import type { BrowserContext, Page } from "@playwright/test";
import { GOOGLE_GSI_SCRIPT_URL } from "@/lib/auth/google-shared";

/**
 * A stand-in for Google Identity Services (https://accounts.google.com/gsi/client), shared by the
 * Google sign-in specs (M1-29, M1-30) and the older sign-in specs that touch the Google button.
 * `renderButton` draws a plain face that, when pressed, hands `window.__gsiCredential` to the
 * callback the page registered with `initialize`, exactly as Google's iframe would. Google's real
 * login is never driven. Route it with `routeGoogleScript` before the page loads.
 */

export const GSI_STUB = `
(() => {
  const state = (window.__gsi = { inits: [], renders: [], clicks: 0 });
  window.google = { accounts: { id: {
    initialize(config) {
      state.config = config;
      state.inits.push({
        client_id: config.client_id,
        nonce: config.nonce,
        ux_mode: config.ux_mode,
        auto_select: config.auto_select,
      });
    },
    renderButton(box, options) {
      state.renders.push({ ...options });
      box.replaceChildren();
      const face = document.createElement("div");
      face.setAttribute("data-gsi-stub", "");
      face.setAttribute("tabindex", "0");
      face.textContent = "Sign in with Google";
      face.style.cssText = "height:40px;width:" + options.width +
        "px;display:flex;align-items:center;justify-content:center;border:1px solid #ccc;cursor:pointer";
      face.addEventListener("click", () => {
        state.clicks++;
        state.config.callback({ credential: window.__gsiCredential });
      });
      box.appendChild(face);
    },
    cancel() {},
    disableAutoSelect() {},
    prompt() {},
  } } };
})();
`;

export interface Gsi {
  inits: { client_id: string; nonce: string; ux_mode: string; auto_select: boolean }[];
  renders: Record<string, unknown>[];
  clicks: number;
}
export const gsi = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gsi: Gsi }).__gsi as Gsi);
export const stubFace = (page: Page) => page.locator("[data-gsi-stub]");

/** Serves the stub for Google's script (or, with `stub` false, makes the script fail to load). */
export async function routeGoogleScript(context: BrowserContext, stub = true): Promise<void> {
  await context.route(GOOGLE_GSI_SCRIPT_URL, (route) =>
    stub
      ? route.fulfill({ status: 200, contentType: "text/javascript", body: GSI_STUB })
      : route.abort(),
  );
}

/** What the stub's face hands to the page's callback when it is pressed. */
export const setGoogleCredential = (page: Page, credential: string) =>
  page.evaluate((value) => {
    (window as unknown as { __gsiCredential: string }).__gsiCredential = value;
  }, credential);
