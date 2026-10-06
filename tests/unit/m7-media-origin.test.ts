// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { APP_CONTENT_SECURITY_POLICY } from "@/lib/routing/app-headers";
import { TENANT_CONTENT_SECURITY_POLICY } from "@/lib/routing/tenant-headers";
import { shareContentSecurityPolicy } from "@/lib/previews/share-headers";
import { fullPublished, noirTokens } from "./fixtures/page-document";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/** Images load from one canonical origin (the root host), so the CDN keeps one copy per image. */
const ROOT = "http://localhost:3000";
const UID = "0b6f1a5e-7c1d-4a52-9d0e-3a7c5e8f2b14";

const imgSrc = (policy: string): string[] =>
  (policy.split("; ").find((d) => d.startsWith("img-src ")) ?? "").split(" ").slice(1);

describe("images load from the root origin: Content-Security-Policy", () => {
  it("the tenant and the share policy list the root origin under img-src, exactly, with no wildcard", () => {
    for (const policy of [TENANT_CONTENT_SECURITY_POLICY, shareContentSecurityPolicy("n", false)]) {
      expect(imgSrc(policy)).toEqual(["'self'", ROOT]);
      expect(policy).not.toMatch(/img-src[^;]*[*]/);
    }
  });

  it("the app host policy sets no img-src, so the root origin is allowed and editor previews work", () => {
    expect(APP_CONTENT_SECURITY_POLICY).not.toMatch(/img-src|default-src/);
  });
});

describe("a tenant page draws every image from the root origin", () => {
  it("<img> srcs and the CSS background url all start with the root origin's /media", () => {
    const stored = `http://127.0.0.1:54321/storage/v1/object/public/page-media/${UID}/bg-0123456789ab.webp`;
    const doc = {
      ...fullPublished,
      tokens: { ...noirTokens, bgType: "image" as const, bgImage: stored },
    };
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        doc,
        pageId: "00000000-0000-4000-8000-0000000000b1",
        mode: "live",
      }),
    );
    // (`data-embed-src` is a facade's player address, which a tap turns into an iframe: not an image.)
    const srcs = [...html.matchAll(/(?<![-\w])src="([^"]+)"/g)].map((m) => m[1]!);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src.startsWith(`${ROOT}/media/`)).toBe(true);
    const urls = [...html.matchAll(/url\((?:&quot;|")([^&")]+)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(`${ROOT}/media/`)).toBe(true);
    expect(html).not.toContain("/storage/v1/");
  });
});
