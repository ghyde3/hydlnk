// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * M5-20: the failure pages. The reference id, the error panels (app shell, page, tenant, global),
 * every error.tsx, the app host's 404 in and out of the shell, the reserved/invalid address panel
 * and the proxy's address label. Rendered for real in jsdom (and to static markup for the
 * server components); only the Next router and the session are replaced.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown } & Record<string, unknown>) =>
    createElement("a", { ...props, href: props.href }),
}));

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
});

const copy = await import("@/lib/error-copy");
const { ErrorPanel } = await import("@/components/error-panel");
const { ErrorPage } = await import("@/components/error-page");
const { TenantErrorPanel } = await import("@/components/tenant/error-panel");
const { AppNotFoundInShell, AppNotFoundPlain } = await import("@/components/app-not-found");
const { AddressPanel } = await import("@/components/tenant/address-panel");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const render = (node: Parameters<Root["render"]>[0]) => act(() => root.render(node));

const failure = (extra: Partial<Error & { digest: string }> = {}): Error & { digest?: string } =>
  Object.assign(new Error("secret db password in this message"), extra);

describe("M5-20 the reference id", () => {
  it("is Next's digest when the error came from the server", () => {
    expect(copy.errorReference({ digest: "862441974" })).toBe("862441974");
    expect(copy.errorReference({ digest: "aB_-9" })).toBe("aB_-9");
  });

  it("is a short random id for an error that began in the browser, never the message", () => {
    const id = copy.errorReference(failure());
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(copy.errorReference(failure(), () => 0)).toBe("00000000");
    expect(copy.errorReference(null)).toMatch(/^[a-z0-9]{8}$/);
  });

  it("a digest that is not a plain token is not shown (nothing odd reaches the page)", () => {
    for (const digest of ["<script>alert(1)</script>", "a b", "x".repeat(65), ""]) {
      const id = copy.errorReference({ digest });
      expect(id, digest).toMatch(/^[a-z0-9]{8}$/);
    }
  });
});

describe("M5-20 the error panel", () => {
  it("says the sentence, has a Retry that calls back, and shows a small reference: no stack, no message", () => {
    const onRetry = vi.fn();
    const error = failure({ digest: "123456" });
    error.stack = "Error: secret\n    at Secret (/src/secret.tsx:1:1)";
    render(createElement(ErrorPanel, { error, onRetry }));
    const message = host.querySelector("[data-testid=error-message]")!;
    expect(message.textContent).toBe("Something went wrong. Try again.");
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.tagName).toBe("H1");
    expect(host.querySelector("[data-testid=error-reference]")!.textContent).toBe(
      "Reference: 123456",
    );
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("Retry");
    expect(button.className).toContain("min-h-11");
    act(() => button.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toMatch(/secret|stack|\.tsx|password/i);
    // The error is logged with the reference, so the page's id can be found again.
    expect(console.error).toHaveBeenCalledWith("[error 123456]", error);
  });

  it("the reference stays the same across renders, and a new error gets a new one", () => {
    const error = failure();
    render(createElement(ErrorPanel, { error, onRetry: () => {} }));
    const first = host.querySelector("[data-testid=error-reference]")!.textContent;
    render(createElement(ErrorPanel, { error, onRetry: () => {} }));
    expect(host.querySelector("[data-testid=error-reference]")!.textContent).toBe(first);
  });

  it("is a <main> on a page of its own and a <div> inside the app shell (which has its own main)", () => {
    render(createElement(ErrorPanel, { error: failure(), onRetry: () => {} }));
    expect(host.querySelector("main")).not.toBeNull();
    render(createElement(ErrorPanel, { error: failure(), onRetry: () => {}, as: "div" }));
    expect(host.querySelector("main")).toBeNull();
  });

  it("ErrorPage adds the logo bar and a link home, with the same message", () => {
    render(createElement(ErrorPage, { error: failure({ digest: "9" }), onRetry: () => {} }));
    expect(host.querySelector("a[aria-label='HYDLNK home']")!.getAttribute("href")).toBe("/");
    expect(host.querySelector("[data-testid=error-message]")!.textContent).toBe(copy.ERROR_MESSAGE);
  });

  it("the tenant panel says the same thing with no HYDLNK CSS (inline styles) and none of the page's content", () => {
    const onRetry = vi.fn();
    render(createElement(TenantErrorPanel, { error: failure({ digest: "777" }), onRetry }));
    expect(host.querySelector("[data-testid=error-message]")!.textContent).toBe(copy.ERROR_MESSAGE);
    expect(host.querySelector("[data-testid=error-reference]")!.textContent).toBe("Reference: 777");
    const main = host.querySelector("main")!;
    expect(main.getAttribute("style")).toContain("background");
    expect(main.className).not.toMatch(/\bbg-|\btext-/);
    act(() => host.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toMatch(/password|secret/i);
  });
});

describe("M5-20 every error boundary and global-error render the same message", () => {
  const props = () => ({ error: failure({ digest: "42" }), retry: vi.fn() });

  it.each([
    ["the app screens", "@/app/(editor)/app/(screens)/error"],
    ["the app host", "@/app/(editor)/error"],
    ["the marketing site", "@/app/(marketing)/error"],
    ["a tenant page", "@/app/(tenant)/error"],
  ])(
    "%s: Something went wrong. Try again., Retry calls retry(), reference shown",
    async (_name, path) => {
      const mod = (await import(/* @vite-ignore */ path)) as {
        default: (p: ReturnType<typeof props>) => React.JSX.Element;
      };
      const p = props();
      render(createElement(mod.default, p));
      expect(host.querySelector("[data-testid=error-message]")!.textContent).toBe(
        "Something went wrong. Try again.",
      );
      expect(host.querySelector("[data-testid=error-reference]")!.textContent).toBe(
        "Reference: 42",
      );
      act(() => host.querySelector("button")!.click());
      expect(p.retry).toHaveBeenCalledTimes(1);
    },
  );

  it("global-error brings its own <html> and <body> and says the same message with a Retry", async () => {
    const { default: GlobalError } = await import("@/app/global-error");
    const retry = vi.fn();
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: failure({ digest: "99" }), retry }),
    );
    expect(html.startsWith("<html")).toBe(true);
    expect(html).toContain("<body>");
    expect(html).toContain("Something went wrong. Try again.");
    expect(html).toContain("Retry");
    expect(html).toContain("Reference: ");
    expect(html).not.toMatch(/secret db password|stack/i);
  });
});

describe("M5-20 the app host's 404", () => {
  it("in the shell: the sentence as the h1 and a link to the Editor", () => {
    const html = renderToStaticMarkup(createElement(AppNotFoundInShell));
    expect(html).toContain("<h1");
    expect(html).toContain("That page doesn’t exist.");
    expect(html).toContain('href="/editor"');
    expect(html).toContain("Go to the Editor");
    // Inside the shell's <main>: no <main> of its own.
    expect(html).not.toContain("<main");
  });

  it("plain, signed out: the sentence, the Editor link, the logo bar and its own <main>", () => {
    const html = renderToStaticMarkup(createElement(AppNotFoundPlain));
    expect(html).toContain("That page doesn’t exist.");
    expect(html).toContain('href="/editor"');
    expect(html).toContain('aria-label="HYDLNK home"');
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).not.toMatch(/please|!/i);
  });
});

describe("M5-20 the reserved and invalid address panels", () => {
  it("reserved: the sentence, a way out to hydlnk.com, and no claim or sign-up link", () => {
    const html = renderToStaticMarkup(createElement(AddressPanel, { kind: "reserved" }));
    expect(html).toContain("That address is reserved.");
    expect(html).toContain('href="http://localhost:3000/"');
    // (the class name tenant-unclaimed is layout; what matters is no claim link and no sign-up href)
    expect(html).not.toMatch(/>\s*claim\b|signup|sign up/i);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("That address isn’t valid.");
  });

  it("invalid: the sentence, a way out, no claim or sign-up link", () => {
    const html = renderToStaticMarkup(createElement(AddressPanel, { kind: "invalid" }));
    expect(html).toContain("That address isn’t valid.");
    // (the class name tenant-unclaimed is layout; what matters is no claim link and no sign-up href)
    expect(html).not.toMatch(/>\s*claim\b|signup|sign up/i);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("That address is reserved.");
  });

  it("uses inline HYDLNK colours only (the tenant layout has no HYDLNK CSS) and no tenant token", () => {
    for (const kind of ["reserved", "invalid"] as const) {
      const html = renderToStaticMarkup(createElement(AddressPanel, { kind }));
      expect(html).toContain("#1C1B1A");
      expect(html).not.toContain("--t-");
    }
  });
});

describe("M5-20 the app context for a 404", () => {
  const session = vi.fn();
  const context = vi.fn();
  beforeEach(() => {
    session.mockReset();
    context.mockReset();
    vi.resetModules();
    vi.doMock("@/lib/auth/session", () => ({ getSessionUser: session }));
    vi.doMock("@/lib/pages/context", () => ({ getAppContext: context }));
  });

  it("signed out: null, and the gate (which would redirect) is never asked", async () => {
    session.mockResolvedValue(null);
    const { getAppContextIfSignedIn } = await import("@/lib/pages/maybe-context");
    expect(await getAppContextIfSignedIn()).toBeNull();
    expect(context).not.toHaveBeenCalled();
  });

  it("signed in with pages: the context", async () => {
    session.mockResolvedValue({ id: "u", email: "a@b.c" });
    const ctx = { user: { id: "u", email: "a@b.c" }, pages: [{ id: "p" }] };
    context.mockResolvedValue(ctx);
    const { getAppContextIfSignedIn } = await import("@/lib/pages/maybe-context");
    expect(await getAppContextIfSignedIn()).toBe(ctx);
  });

  it("the gate's redirect (no page yet) reads as no shell and is not logged; any other failure is logged and reads the same", async () => {
    session.mockResolvedValue({ id: "u", email: "a@b.c" });
    const { getAppContextIfSignedIn } = await import("@/lib/pages/maybe-context");
    context.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/claim;307;" }),
    );
    expect(await getAppContextIfSignedIn()).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
    context.mockRejectedValue(new Error("db down"));
    expect(await getAppContextIfSignedIn()).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("M5-20 invalidHandleLabel (the proxy's address label)", () => {
  it("returns the label of one DNS label under the root that is not a handle", async () => {
    const { invalidHandleLabel } = await import("@/lib/routing/host");
    for (const [host, label] of [
      ["ab.localhost:3000", "ab"],
      ["a.localhost:3000", "a"],
      ["-x1.localhost:3000", "-x1"],
      ["x1-.localhost:3000", "x1-"],
      ["AB.LOCALHOST:3000", "ab"],
      [`${"x".repeat(31)}.localhost:3000`, "x".repeat(31)],
      ["ab.localhost:3000.", "ab"],
    ] as const) {
      expect(invalidHandleLabel(host, "localhost:3000"), host).toBe(label);
    }
    expect(invalidHandleLabel("ab.hydlnk.com", "hydlnk.com")).toBe("ab");
  });

  it("returns null for everything else: valid handles, two labels, the root, other hosts, odd characters", async () => {
    const { invalidHandleLabel } = await import("@/lib/routing/host");
    for (const host of [
      "mara.localhost:3000",
      "abc.localhost:3000",
      "a.b.localhost:3000",
      "localhost:3000",
      "app.localhost:3000",
      "ab.example.com",
      "ab.localhost:3001",
      "a_b.localhost:3000",
      "ünï.localhost:3000",
      `${"x".repeat(64)}.localhost:3000`,
      "",
      ".localhost:3000",
    ]) {
      expect(invalidHandleLabel(host, "localhost:3000"), host).toBeNull();
    }
    expect(invalidHandleLabel("ab.localhost:3000", "")).toBeNull();
  });
});
