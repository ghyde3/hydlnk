/**
 * `pnpm lighthouse` (M5-21): Lighthouse plus a few page checks of its own against public tenant pages.
 *
 *   pnpm lighthouse                       build, `next start` on :3000, make the fixture pages, audit, stop
 *   pnpm lighthouse --skip-build          reuse the existing production build (.next)
 *   pnpm lighthouse --reuse-server        audit a production server that already answers on :3000
 *   pnpm lighthouse --url https://{handle}.hydlnk.com   audit one live page (no build, server or fixtures)
 *
 * Local targets: http://mara.localhost:3000/ and four fixture pages (Ivory, Smoke, a Free page with the
 * badge, a page with a photo and a background image), each in a mobile preset (390x844, simulated slow
 * 4G, 4x CPU) and a desktop preset (1440x900). Lighthouse is driven with the Chromium Playwright
 * installs (remote debugging port), so no other browser is downloaded. The Lighthouse JSON goes to
 * tmp/lighthouse/, a score table is printed, and the exit code is 1 when any threshold, budget or
 * page check fails. Only the audited site is requested.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createFixtures, removeFixtures } from "./lib/lighthouse-fixtures";
import { DESKTOP, PHONE } from "./lib/viewports";

const PORT = 3000;
const OUT_DIR = path.resolve(process.cwd(), "tmp", "lighthouse");
const USAGE =
  "Usage: pnpm lighthouse [--skip-build] [--reuse-server] [--url https://{handle}.hydlnk.com]";

type Preset = "mobile" | "desktop";
interface Target {
  name: string;
  url: string;
}

const THRESHOLDS = {
  mobile: { performance: 90, accessibility: 95, "best-practices": 95, seo: 95 },
  desktop: { performance: 95, accessibility: 95, "best-practices": 95, seo: 95 },
} as const;
const MOBILE_METRICS = { lcpMs: 2500, cls: 0.05, tbtMs: 200 };
const FIRST_LOAD_JS_GZIP_BYTES = 100 * 1024;
export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

// Code that must never reach a public tenant page: the editor, the Supabase client, React's runtime.
const FORBIDDEN_CODE = [
  "@supabase",
  "supabase-js",
  "/rest/v1",
  "/auth/v1",
  "dnd-kit",
  "tiptap",
  "prosemirror",
  "react-dom",
  "__NEXT_DATA__",
];
const EMBED_HOSTS = /youtube|youtu\.be|ytimg|googlevideo|spotify|scdn\.co/i;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args = { skipBuild: false, reuseServer: false, url: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--skip-build") args.skipBuild = true;
    else if (arg === "--reuse-server") args.reuseServer = true;
    else if (arg === "--url") args.url = argv[++i] ?? fail(`--url needs a value.\n${USAGE}`);
    else if (arg.startsWith("--url=")) args.url = arg.slice("--url=".length);
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else fail(`Unknown option ${arg}.\n${USAGE}`);
  }
  if (args.url) {
    let parsed: URL;
    try {
      parsed = new URL(args.url);
    } catch {
      fail(`--url is not a URL: ${args.url}`);
    }
    if (parsed.protocol !== "https:") fail("--url must be an https URL.");
  }
  return args;
}

// ---------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3_000) });
    return true;
  } catch {
    return false;
  }
}

function startServer(): ChildProcess {
  const child = spawn("./node_modules/.bin/next", ["start", "-p", String(PORT)], {
    stdio: "ignore",
    env: { ...process.env, NEXT_PUBLIC_ROOT_DOMAIN: `localhost:${PORT}` },
  });
  return child;
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await answers(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`The production server did not answer at ${url}.`);
}

// ---------------------------------------------------------------------------------------------
// Lighthouse
// ---------------------------------------------------------------------------------------------

interface AuditSummary {
  scores: Record<(typeof CATEGORIES)[number], number>;
  lcpMs: number;
  cls: number;
  tbtMs: number;
  failedAudits: string[];
}

async function runLighthouse(url: string, preset: Preset, file: string): Promise<AuditSummary> {
  // A plain node child (not tsx): tsx's esbuild helpers break the functions Lighthouse sends to the page.
  const child = spawnSync(process.execPath, ["scripts/lib/lighthouse-run.mjs", url, preset, file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0)
    throw new Error(`Lighthouse failed for ${url}: ${child.stderr || child.stdout}`);
  return JSON.parse(child.stdout) as AuditSummary;
}

function thresholdFailures(preset: Preset, s: AuditSummary): string[] {
  const out: string[] = [];
  for (const id of CATEGORIES) {
    const min = THRESHOLDS[preset][id];
    if (s.scores[id] < min) out.push(`${id} ${s.scores[id]} < ${min}`);
  }
  if (preset === "mobile") {
    if (s.lcpMs > MOBILE_METRICS.lcpMs) out.push(`LCP ${s.lcpMs} ms > ${MOBILE_METRICS.lcpMs}`);
    if (s.cls > MOBILE_METRICS.cls) out.push(`CLS ${s.cls} > ${MOBILE_METRICS.cls}`);
    if (s.tbtMs > MOBILE_METRICS.tbtMs) out.push(`TBT ${s.tbtMs} ms > ${MOBILE_METRICS.tbtMs}`);
  }
  if (s.failedAudits.some((a) => a.startsWith("color-contrast"))) out.push("color-contrast fails");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Page checks (budgets, accessibility, SEO, scroll width), in Playwright
// ---------------------------------------------------------------------------------------------

interface PageReport {
  scroll: { phone: [number, number]; desktop: [number, number] };
  jsKb: number;
  failures: string[];
}

/** True when `host` is the registrable parent of the tenant host (`mara.localhost:3000` -> `localhost:3000`). */
function isRootHostOf(host: string, tenantHost: string): boolean {
  return tenantHost.endsWith(`.${host}`);
}

function sameSite(requestUrl: string, pageUrl: string): boolean {
  return new URL(requestUrl).origin === new URL(pageUrl).origin;
}

async function checkPage(browser: Browser, url: string): Promise<PageReport> {
  const failures: string[] = [];
  const origin = new URL(url);

  // ---- phone: budgets, touch targets, structure, SEO
  const phone = await browser.newContext({ ...PHONE });
  await phone.addInitScript("window.__name = (fn) => fn;"); // tsx's esbuild wraps evaluate callbacks
  const page = await phone.newPage();
  const requested: string[] = [];
  const scripts: { url: string; gzip: number; body: string }[] = [];
  page.on("request", (r) => requested.push(r.url()));
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script") return;
    void response
      .body()
      .then((body) =>
        scripts.push({ url: response.url(), gzip: gzipSync(body).length, body: body.toString() }),
      )
      .catch(() => undefined);
  });
  const main = await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // Budgets: JavaScript.
  const total = scripts.reduce((sum, s) => sum + s.gzip, 0);
  if (total > FIRST_LOAD_JS_GZIP_BYTES) {
    failures.push(`first-load JS ${(total / 1024).toFixed(1)} KB gzipped > 100 KB`);
  }
  for (const script of scripts) {
    for (const marker of FORBIDDEN_CODE) {
      if (script.body.includes(marker)) failures.push(`${script.url} contains "${marker}"`);
    }
  }
  // Budgets: requests. Only the page's own host (document, script, fonts, beacon), plus public
  // Storage images; never Supabase REST or Auth, never an app host call apart from /api/e.
  for (const requestUrl of requested) {
    if (requestUrl.startsWith("data:") || requestUrl.startsWith("blob:")) continue;
    const u = new URL(requestUrl);
    if (/\/(rest|auth)\/v1(\/|$)/.test(u.pathname)) failures.push(`request to ${u.pathname}`);
    else if (u.pathname.includes("/storage/v1/object/public/")) continue;
    // Uploaded images are served from the root host's /media/ path (one CDN cache key per image).
    else if (u.pathname.startsWith("/media/") && isRootHostOf(u.host, origin.host)) continue;
    else if (u.host.startsWith("app.")) failures.push(`request to the app host: ${requestUrl}`);
    else if (!sameSite(requestUrl, url)) failures.push(`third-party request: ${requestUrl}`);
  }
  // Budgets: embeds. Nothing from YouTube or Spotify and no iframe until a play button is tapped.
  for (const requestUrl of requested) {
    if (EMBED_HOSTS.test(new URL(requestUrl).host)) failures.push(`embed loaded: ${requestUrl}`);
  }
  if ((await page.locator("iframe").count()) > 0) failures.push("an iframe is present on load");

  // Budgets: fonts. Every @font-face swaps, only families the page's tokens name are declared, and
  // a font file is a request to the page's own host (preloaded in the head, so no preconnect).
  const fonts = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-page-root]");
    const style = root ? getComputedStyle(root) : null;
    const named = ["--t-font-heading", "--t-font-body"]
      .map((v) => style?.getPropertyValue(v) ?? "")
      .join(",")
      .split(",")
      .map((f) =>
        f
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase(),
      );
    const faces: { family: string; display: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSFontFaceRule) {
          faces.push({
            family: rule.style
              .getPropertyValue("font-family")
              .replace(/^["']|["']$/g, "")
              .toLowerCase(),
            display: rule.style.getPropertyValue("font-display"),
          });
        }
      }
    }
    const preloads = Array.from(document.querySelectorAll('link[rel="preload"][as="font"]')).length;
    return { named, faces, preloads };
  });
  for (const face of fonts.faces) {
    if (face.display !== "swap")
      failures.push(`@font-face ${face.family} is not font-display: swap`);
    if (!fonts.named.includes(face.family)) failures.push(`unused font family ${face.family}`);
  }
  if (fonts.faces.length > 0 && fonts.preloads === 0) failures.push("fonts are not preloaded");

  // Accessibility: one h1 equal to the display name; every link and button at least 44x44.
  const dom = await page.evaluate(() => {
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("a[href], button"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < 43.5 || rect.height < 43.5) {
        small.push(
          `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 24)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
      }
    }
    const h1 = Array.from(document.querySelectorAll("h1")).map((h) => (h.textContent ?? "").trim());
    const meta = (selector: string) =>
      document.querySelector<HTMLMetaElement>(selector)?.getAttribute("content") ?? null;
    return {
      small,
      h1,
      lang: document.documentElement.getAttribute("lang"),
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      ogImage: meta('meta[property="og:image"]'),
      robots: meta('meta[name="robots"]'),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  for (const item of dom.small) failures.push(`touch target under 44x44: ${item}`);
  if (dom.h1.length !== 1) failures.push(`${dom.h1.length} h1 elements (want 1)`);
  const name = dom.h1[0] ?? "";

  // SEO.
  if (!dom.title.startsWith(name) || name === "")
    failures.push(`title "${dom.title}" lacks the name`);
  if (!dom.description) failures.push("no meta description");
  if (!dom.lang) failures.push("html lang is not set");
  const local = origin.hostname.endsWith("localhost");
  const canonical = dom.canonical ? safeUrl(dom.canonical) : null;
  if (!canonical) failures.push("no absolute canonical URL");
  else if (canonical.host !== origin.host || (!local && canonical.protocol !== "https:")) {
    failures.push(`canonical ${dom.canonical} is not the served host over https`);
  }
  if (!dom.ogImage || !safeUrl(dom.ogImage)) failures.push("og:image missing or not absolute");
  if (dom.robots && /noindex/i.test(dom.robots)) failures.push("meta robots says noindex");
  const header = main?.headers()["x-robots-tag"];
  if (header && /noindex/i.test(header)) failures.push("X-Robots-Tag says noindex");
  const phoneScroll: [number, number] = [dom.scrollWidth, dom.innerWidth];
  if (dom.scrollWidth > dom.innerWidth)
    failures.push(`phone scrollWidth ${dom.scrollWidth} > ${dom.innerWidth}`);
  await phone.close();

  // ---- desktop: scroll width
  const desk = await browser.newContext({ ...DESKTOP });
  await desk.addInitScript("window.__name = (fn) => fn;");
  const deskPage: Page = await desk.newPage();
  await deskPage.goto(url, { waitUntil: "networkidle" });
  const d = await deskPage.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  const desktopScroll: [number, number] = [d[0]!, d[1]!];
  if (d[0]! > d[1]!) failures.push(`desktop scrollWidth ${d[0]} > ${d[1]}`);
  await desk.close();

  return {
    scroll: { phone: phoneScroll, desktop: desktopScroll },
    jsKb: Number((total / 1024).toFixed(1)),
    failures,
  };
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(OUT_DIR, { recursive: true });

  let server: ChildProcess | null = null;
  let madeFixtures = false;
  let targets: Target[];

  try {
    if (args.url) {
      const u = new URL(args.url);
      targets = [{ name: u.hostname.split(".")[0] ?? "live", url: u.toString() }];
    } else {
      const base = `http://localhost:${PORT}/`;
      if (!args.reuseServer) {
        if (await answers(base))
          fail(`Something already answers on :${PORT}; stop it or use --reuse-server.`);
        if (!args.skipBuild) {
          const build = spawnSync("pnpm", ["build"], { stdio: "ignore" });
          if (build.status !== 0) fail("pnpm build failed (run `pnpm build` to see why).");
        }
        server = startServer();
      }
      await waitFor(base);
      const fixtures = await createFixtures();
      madeFixtures = true;
      targets = [
        { name: "mara", url: `http://mara.localhost:${PORT}/` },
        ...fixtures.map((f) => ({ name: f.name, url: `http://${f.handle}.localhost:${PORT}/` })),
      ];
    }

    const browser = await chromium.launch();
    const rows: string[] = [];
    const problems: string[] = [];
    try {
      for (const target of targets) {
        for (const preset of ["mobile", "desktop"] as const) {
          const summary = await runLighthouse(
            target.url,
            preset,
            path.join(OUT_DIR, `${target.name}-${preset}.json`),
          );
          const found = thresholdFailures(preset, summary);
          const s = summary.scores;
          rows.push(
            [
              target.name.padEnd(11),
              preset.padEnd(8),
              String(s.performance).padStart(4),
              String(s.accessibility).padStart(4),
              String(s["best-practices"]).padStart(4),
              String(s.seo).padStart(4),
              String(summary.lcpMs).padStart(7),
              String(summary.cls).padStart(6),
              String(summary.tbtMs).padStart(6),
              found.length === 0 ? "PASS" : "FAIL",
            ].join("  "),
          );
          for (const f of found) problems.push(`${target.name} ${preset}: ${f}`);
          if (found.length > 0 && summary.failedAudits.length > 0) {
            problems.push(
              `${target.name} ${preset}: weak audits: ${summary.failedAudits.join(", ")}`,
            );
          }
        }
        const report = await checkPage(browser, target.url);
        rows.push(
          `${target.name.padEnd(11)}  checks   scrollWidth/innerWidth phone ${report.scroll.phone.join("/")}, desktop ${report.scroll.desktop.join("/")}, first-load JS ${report.jsKb} KB gz  ${report.failures.length === 0 ? "PASS" : "FAIL"}`,
        );
        for (const f of report.failures) problems.push(`${target.name} checks: ${f}`);
      }
    } finally {
      await browser.close();
    }

    console.log("page         preset    perf   a11y    bp   seo  LCP ms     CLS  TBT ms  result");
    for (const row of rows) console.log(row);
    if (problems.length > 0) {
      console.log("\nFailures:");
      for (const p of problems) console.log(`  ${p}`);
      console.log(`\nLighthouse JSON: ${OUT_DIR}`);
      return 1;
    }
    console.log(`\nAll thresholds and checks pass. Lighthouse JSON: ${OUT_DIR}`);
    return 0;
  } finally {
    if (madeFixtures) await removeFixtures().catch(() => undefined);
    if (server) server.kill("SIGTERM");
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  },
);
