import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * M1-29 / M1-30: Google's button is optional. With no NEXT_PUBLIC_GOOGLE_CLIENT_ID the button and
 * the "or" rule above it are gone from the server-rendered page, and email sign-in stands alone.
 */

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: undefined as string | undefined,
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: env }));
vi.mock("next/script", () => ({
  default: (props: { src: string }) => createElement("script", { "data-src": props.src }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));
vi.mock("@/lib/auth/google-actions", () => ({
  prepareGoogleSignIn: async () => ({ ok: false }),
  signInWithGoogle: async () => ({ kind: "error", message: "x" }),
}));

const { GoogleButton, OrDivider } = await import("@/components/auth/google-button");

describe("Google button without a client id", () => {
  it("renders nothing, and neither does the 'or' rule", () => {
    env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = undefined;
    expect(renderToStaticMarkup(createElement(GoogleButton))).toBe("");
    expect(renderToStaticMarkup(createElement(OrDivider))).toBe("");
  });

  it("does not load Google's script either", () => {
    env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = undefined;
    expect(renderToStaticMarkup(createElement(GoogleButton))).not.toContain("gsi/client");
  });
});

describe("Google button with a client id", () => {
  it("renders the 'or' rule, Google's script and a disabled placeholder until Google has drawn the button", () => {
    env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    expect(renderToStaticMarkup(createElement(OrDivider))).toContain('role="separator"');

    const html = renderToStaticMarkup(createElement(GoogleButton));
    expect(html).toContain("https://accounts.google.com/gsi/client");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue with Google<\/button>/);
    // The client id is public but the page never needs to print it: it is read where it is used.
    expect(html).not.toContain("test-client.apps.googleusercontent.com");
  });
});
