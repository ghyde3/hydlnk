/**
 * Full-page screenshots of a route at the two HYDLNK viewports (phone 390x844 @3x, desktop 1440x900).
 *
 *   pnpm screens <route> [--host app|<handle>]
 *   pnpm screens /                   -> http://localhost:3000/
 *   pnpm screens /signup --host app  -> http://app.localhost:3000/signup
 *   pnpm screens / --host mara       -> http://mara.localhost:3000/
 *
 * Writes tmp/screens/<host>-<slug>-<width>.png (host is "root" when --host is omitted; slug is
 * the route with non-alphanumerics turned into "-", "index" for "/") and prints the absolute paths.
 * Assumes the dev server is already running (pnpm dev, or scripts/init.sh).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { DESKTOP, PHONE } from "./lib/viewports";

const DEV_PORT = 3000;
const OUT_DIR = path.resolve(process.cwd(), "tmp", "screens");

const USAGE =
  "Usage: pnpm screens <route> [--host app|<handle>]   e.g. pnpm screens /signup --host app";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): { route: string; host: string | null } {
  let host: string | null = null;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--host") {
      const value = argv[++i];
      if (!value) fail(`--host needs a value.\n${USAGE}`);
      host = value;
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    } else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith("--")) {
      fail(`Unknown option ${arg}.\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }
  const route = positional[0];
  if (!route || positional.length > 1) fail(USAGE);
  if (host === "" || host === "root") host = null;
  if (host !== null && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)) {
    fail(
      `Invalid --host "${host}". Use "app" or a tenant handle (lowercase letters, digits, hyphens).`,
    );
  }
  return { route: route.startsWith("/") ? route : `/${route}`, host };
}

function slugify(route: string): string {
  const slug = route
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "index";
}

async function assertDevServerUp(): Promise<void> {
  try {
    await fetch(`http://localhost:${DEV_PORT}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    fail(
      `Dev server is not answering at http://localhost:${DEV_PORT}.\n` +
        "Start it with `pnpm dev` (or run scripts/init.sh), then try again.",
    );
  }
}

async function main(): Promise<void> {
  const { route, host } = parseArgs(process.argv.slice(2));
  const hostname = host ? `${host}.localhost` : "localhost";
  const target = `http://${hostname}:${DEV_PORT}${route}`;
  const slug = slugify(route);

  await assertDevServerUp();
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const profile of [PHONE, DESKTOP]) {
      const context = await browser.newContext(profile);
      try {
        const page = await context.newPage();
        const response = await page.goto(target, { waitUntil: "load", timeout: 60_000 });
        // Let late network activity and web fonts settle; never block on a chatty dev server.
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(OUT_DIR, `${host ?? "root"}-${slug}-${profile.viewport.width}.png`);
        await page.screenshot({ path: file, fullPage: true });
        const { width, height } = profile.viewport;
        console.log(`${width}x${height}  HTTP ${response?.status() ?? "?"}  ${file}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  fail(
    `screens failed for the requested route: ${error instanceof Error ? error.message : String(error)}`,
  );
});
