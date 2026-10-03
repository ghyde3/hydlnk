// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { TenantPage } from "@/components/tenant/tenant-page";
import { ViewBeacon, viewBeaconScript } from "@/components/tenant/view-beacon";
import { fullPublished } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

describe("M4-21 the view beacon script", () => {
  it("calls navigator.sendBeacon once, with a relative URL, a JSON string of {pageId, referrer}, after load", () => {
    const script = viewBeaconScript(PAGE_ID);
    expect((script.match(/sendBeacon\(/g) ?? []).length).toBe(1);
    expect(script).toContain("sendBeacon('/api/e',JSON.stringify({pageId:id,referrer:document.referrer}))");
    expect(script).not.toMatch(/https?:\/\//);
    expect(script).toContain(`var id="${PAGE_ID}"`);
    // After load: now if the document is already complete, else on the load event, and only once.
    expect(script).toContain("document.readyState==='complete'");
    expect(script).toContain("addEventListener('load',s,{once:true})");
  });

  it("uses no cookie and no storage", () => {
    const script = viewBeaconScript(PAGE_ID);
    expect(script).not.toMatch(/cookie\b(?!:)/);
    expect(script).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(script).not.toMatch(/doNotTrack/i);
  });

  it("is a few lines: under 400 bytes", () => {
    expect(viewBeaconScript(PAGE_ID).length).toBeLessThan(400);
  });

  it("refuses anything that is not a UUID, so nothing else is ever written into the script", () => {
    for (const bad of ['"};alert(1);//', "p1", "", "</script>", `${PAGE_ID}"`]) {
      expect(() => viewBeaconScript(bad)).toThrow();
    }
  });

  it("runs once per load and posts the page id and the referrer (jsdom)", () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    Object.defineProperty(document, "referrer", { value: "https://l.instagram.com/?u=x", configurable: true });
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "readyState");
    const states: string[] = [];
    Object.defineProperty(document, "readyState", { get: () => states.at(-1) ?? "loading", configurable: true });

    states.push("loading");
    new Function(viewBeaconScript(PAGE_ID))();
    expect(sendBeacon).not.toHaveBeenCalled(); // waits for load
    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("load"));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("/api/e");
    expect(JSON.parse(body)).toEqual({ pageId: PAGE_ID, referrer: "https://l.instagram.com/?u=x" });

    sendBeacon.mockClear();
    states.push("complete");
    new Function(viewBeaconScript(PAGE_ID))();
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    if (original) Object.defineProperty(document, "readyState", original);
    else delete (document as unknown as Record<string, unknown>).readyState;
  });

  it("a sendBeacon that throws or is missing never breaks the page", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: () => {
        throw new Error("blocked");
      },
      configurable: true,
    });
    const states = ["complete"];
    Object.defineProperty(document, "readyState", { get: () => states[0], configurable: true });
    expect(() => new Function(viewBeaconScript(PAGE_ID))()).not.toThrow();
  });
});

describe("M4-21 where the beacon is, and where it is not", () => {
  it("the live page carries exactly one beacon script; the renderer alone and the preview carry none", () => {
    const live = renderToStaticMarkup(
      createElement(TenantPage, { document: fullPublished, pageId: PAGE_ID, plan: "free" }),
    );
    expect((live.match(/<script/g) ?? []).length).toBe(1);
    expect(live).toContain("/api/e");

    const renderer = renderToStaticMarkup(
      createElement(PageRenderer, { doc: fullPublished, pageId: PAGE_ID, mode: "preview" }),
    );
    expect(renderer).not.toContain("<script");
    expect(renderer).not.toContain("/api/e");
  });

  it("only TenantPage renders ViewBeacon: not the renderer, not the editor", () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?)$/.test(entry.name) && /ViewBeacon|view-beacon/.test(readFileSync(full, "utf8"))) {
          users.push(full.slice(root.length + 1));
        }
      }
    };
    walk(join(root, "src"));
    expect(users.sort()).toEqual(["src/components/tenant/tenant-page.tsx", "src/components/tenant/view-beacon.tsx"]);
  });

  it("the beacon element is a plain script with the inline code and nothing else", () => {
    const html = renderToStaticMarkup(createElement(ViewBeacon, { pageId: PAGE_ID }));
    expect(html).toBe(`<script>${viewBeaconScript(PAGE_ID)}</script>`);
  });
});

describe("M4-20, M4-21, M4-22 static rules for the tracking routes", () => {
  const ingest = join(root, "src/lib/analytics/ingest");
  const files = readdirSync(ingest).filter((name) => name.endsWith(".ts"));

  it("no file sets or reads a cookie", () => {
    for (const name of files) {
      expect(strip(read(`src/lib/analytics/ingest/${name}`)), name).not.toMatch(/cookies\(|set-cookie|document\.cookie|\.cookie\b/i);
    }
    expect(strip(read("src/app/api/e/route.ts"))).not.toMatch(/cookie/i);
    expect(strip(read("src/app/r/[pageId]/[blockId]/route.ts"))).not.toMatch(/cookie/i);
  });

  it("no ingest file is a Client Component", () => {
    for (const name of files) expect(read(`src/lib/analytics/ingest/${name}`), name).not.toMatch(/"use client"/);
  });

  it("everything that reaches the database imports server-only and uses the secret-key client", () => {
    for (const name of ["insert.ts", "pages.ts", "hash.ts", "secret.ts", "deps.ts", "routes.ts"]) {
      expect(read(`src/lib/analytics/ingest/${name}`), name).toMatch(/^import "server-only";/m);
    }
    expect(read("src/lib/analytics/ingest/insert.ts")).toMatch(/createAdminSupabase/);
    expect(read("src/lib/analytics/ingest/pages.ts")).toMatch(/createAdminSupabase/);
  });

  it("the two page reads select only what they need: never the draft, never *", () => {
    const source = read("src/lib/analytics/ingest/pages.ts");
    const selects = [...source.matchAll(/\.select\(\s*"([^"]*)"\s*\)/g)].map((m) => m[1]!);
    expect(selects).toEqual([
      "handle, accounts!inner(suspended_at), domains(hostname, status)",
      "published, accounts!inner(suspended_at)",
    ]);
    for (const select of selects) expect(select).not.toMatch(/\bdraft\b|\*/);
    expect(strip(source)).not.toMatch(/\bdraft\b/);
  });

  it("the click target is read from the published document and parsed with the published schema", () => {
    const source = read("src/lib/analytics/ingest/pages.ts");
    expect(source).toMatch(/publishedDocSchema\.safeParse/);
    expect(read("src/lib/analytics/ingest/target.ts")).toMatch(/isHttpUrl/);
  });

  it("the click handler schedules its insert with after(), and the beacon route does not redirect", () => {
    expect(read("src/lib/analytics/ingest/deps.ts")).toMatch(/after\(task\)/);
    expect(read("src/lib/analytics/ingest/click.ts")).toMatch(/deps\.schedule\(/);
    expect(strip(read("src/lib/analytics/ingest/click.ts"))).not.toMatch(/NextResponse\.redirect|new URL\(request/);
    expect(strip(read("src/lib/analytics/ingest/beacon.ts"))).not.toMatch(/redirect/i);
  });

  it("the click handler never reads the query string", () => {
    const source = strip(read("src/lib/analytics/ingest/click.ts"));
    expect(source).not.toMatch(/searchParams|\.search\b|new URL\(/);
    expect(source).not.toMatch(/headers\.get\("(host|x-forwarded-host|referer)"\)/i);
  });

  it("the two routes exist, each dynamic, and no copy of them hides under the tenant routes", () => {
    const routes = ["src/app/api/e/route.ts", "src/app/r/[pageId]/[blockId]/route.ts"];
    for (const route of routes) {
      const source = read(route);
      expect(source, route).toMatch(/export const dynamic = "force-dynamic"/);
      expect(source, route).toMatch(/export async function GET\(/);
      expect(source, route).toMatch(/export async function HEAD\(/);
    }
    expect(read("src/app/api/e/route.ts")).toMatch(/export async function POST\(/);
    // The proxy leaves the tracking paths unrewritten on tenant and custom hosts, so one pair of
    // routes serves every host (src/lib/routing/paths.ts, src/proxy.ts).
    expect(read("src/proxy.ts")).toMatch(/isTrackingPath\(pathname\)/);
    expect(read("src/lib/routing/paths.ts")).toMatch(/pathname\.startsWith\("\/r\/"\) \|\| pathname === "\/api\/e"/);
  });
});
