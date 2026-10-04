// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { fullPublished } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
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

const { renderLivePage, scriptTag } = await import("@/lib/tenant-render/live-page");
const { TENANT_SCRIPT_SRC } = await import("@/lib/tenant-assets");

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

/** The one script every published page loads (M8-05, M8-06): the file the document names, as built. */
const SCRIPT = read(`public${TENANT_SCRIPT_SRC}`);

/** Runs the script the way a browser does: with its own <script data-page-id> element as `document.currentScript`. */
function run(pageId: string | null) {
  const element = document.createElement("script");
  if (pageId !== null) element.setAttribute("data-page-id", pageId);
  Object.defineProperty(document, "currentScript", { value: element, configurable: true });
  new Function(SCRIPT)();
}

describe("M4-21 the view beacon (the shared tenant script, M8-06)", () => {
  it("calls navigator.sendBeacon once, with a relative URL, a JSON string of {pageId, referrer}, after load", () => {
    expect((SCRIPT.match(/sendBeacon\(/g) ?? []).length).toBe(1);
    expect(SCRIPT).toContain('"/api/e"');
    expect(SCRIPT).toContain("JSON.stringify({ pageId: pageId, referrer: doc.referrer })");
    // After load: now if the document is already complete, else on the load event, and only once.
    expect(SCRIPT).toContain('doc.readyState === "complete"');
    expect(SCRIPT).toContain('window.addEventListener("load", beacon, { once: true })');
  });

  it("uses no cookie and no storage", () => {
    expect(SCRIPT).not.toMatch(/document\.cookie|\.cookie\b/);
    expect(SCRIPT).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(SCRIPT).not.toMatch(/doNotTrack/i);
  });

  it("takes the page id from its own element and sends nothing for a missing, empty or tampered one", () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    Object.defineProperty(document, "readyState", { get: () => "complete", configurable: true });
    for (const bad of [null, "", '"><x', "p1", "</script>", `${PAGE_ID}"`]) {
      expect(() => run(bad), String(bad)).not.toThrow();
    }
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("runs once per load and posts the page id and the referrer (jsdom)", () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    Object.defineProperty(document, "referrer", { value: "https://l.instagram.com/?u=x", configurable: true });
    const states: string[] = ["loading"];
    Object.defineProperty(document, "readyState", { get: () => states.at(-1), configurable: true });

    run(PAGE_ID);
    expect(sendBeacon).not.toHaveBeenCalled(); // waits for load
    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("load"));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("/api/e");
    expect(JSON.parse(body)).toEqual({ pageId: PAGE_ID, referrer: "https://l.instagram.com/?u=x" });

    sendBeacon.mockClear();
    states.push("complete");
    run(PAGE_ID);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("a sendBeacon that throws or is missing never breaks the page", () => {
    Object.defineProperty(document, "readyState", { get: () => "complete", configurable: true });
    Object.defineProperty(navigator, "sendBeacon", {
      value: () => {
        throw new Error("blocked");
      },
      configurable: true,
    });
    expect(() => run(PAGE_ID)).not.toThrow();
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    expect(() => run(PAGE_ID)).not.toThrow();
  });
});

describe("M4-21 where the beacon is, and where it is not", () => {
  it("the live page carries exactly one script, with the page id; the renderer alone and the preview carry none", () => {
    const live = renderLivePage({ pageId: PAGE_ID, document: fullPublished, plan: "free", urls: null });
    expect((live.match(/<script/g) ?? []).length).toBe(1);
    expect(live).toContain(`data-page-id="${PAGE_ID}"`);
    expect(live).not.toContain("/api/e"); // the call is in the script file, never in the document

    const renderer = renderToStaticMarkup(
      createElement(PageRenderer, { doc: fullPublished, pageId: PAGE_ID, mode: "preview" }),
    );
    expect(renderer).not.toContain("<script");
    expect(renderer).not.toContain("/api/e");
    expect(renderer).not.toContain("data-page-id");
  });

  it("only the live builder writes the script tag: not the renderer, not the editor, not a draft view", () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(tsx?|jsx?)$/.test(entry.name) &&
          /TENANT_SCRIPT_SRC|from "@\/lib\/tenant-assets"/.test(readFileSync(full, "utf8"))
        ) {
          users.push(full.slice(root.length + 1));
        }
      }
    };
    walk(join(root, "src"));
    // (The builder's module and the style filter of the state pages take the CSS and the script path from
    // the assets folder; only live-page.tsx writes the tag.)
    expect(users.filter((file) => !file.startsWith("src/lib/tenant-assets/")).sort()).toEqual([
      "src/lib/tenant-render/live-page.tsx",
      "src/lib/tenant-render/state-css.ts",
    ]);
    const tagWriters = users.filter((file) => /TENANT_SCRIPT_SRC/.test(read(file)) && !file.startsWith("src/lib/tenant-assets/"));
    expect(tagWriters).toEqual(["src/lib/tenant-render/live-page.tsx"]);
  });

  it("the script tag is a plain deferred external script, and refuses an id that is not a UUID", () => {
    expect(scriptTag(PAGE_ID)).toMatch(
      /^<script src="\/_t\/p\.[0-9a-f]{12}\.js"( integrity="[^"]+")? data-page-id="[0-9a-f-]{36}" defer><\/script>$/,
    );
    for (const bad of ['"};alert(1);//', "p1", "", "</script>", `${PAGE_ID}"`]) {
      expect(() => scriptTag(bad)).toThrow();
    }
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
      "published, handle, accounts!inner(suspended_at), domains(hostname, status)",
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
    // The only host it may read is the real Host header (the host binding); never a forwarded one.
    expect(source).not.toMatch(/headers\.get\("(x-forwarded-host|x-original-host|referer)"\)/i);
    expect(source).toMatch(/headers\.get\("host"\)/);
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
