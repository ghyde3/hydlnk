import { expect, test } from "@playwright/test";
import { DESKTOP, PHONE } from "../../../scripts/lib/viewports";
import { cleanupUsers } from "../fixtures/data";
import { SERVER_PORT } from "../m2/publish-helpers";
import { FONT_MANIFEST } from "@/lib/tenant-assets/fonts";
import { classify, record } from "./assets-network";
import { seedFullPage, type Seeded } from "./assets-seed";

/**
 * M8-01 on the live page, with the fonts vendored by `pnpm tenant-fonts`: a first visit to the
 * fixture page (a Fraunces 700 heading over an Inter body) requests exactly the two latin files from
 * the page's own host and nothing from Google or any other host (every host but loopback does not
 * resolve in this browser); the document carries no stylesheet link and no preconnect; the faces are
 * loaded; a name that needs latin-ext fetches that subset of the heading family and no other; a
 * second visit makes no font request. Runs against the dev server or a production build
 * (HL_PROD_PORT); the cache header it relies on is declared in next.config.ts.
 */

test.skip(
  FONT_MANIFEST.source.startsWith("pending"),
  "the fonts are not vendored yet: run `pnpm tenant-fonts`",
);

// Every host but the local ones fails to resolve: "blocked at the network".
test.use({
  launchOptions: {
    args: [
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1",
    ],
  },
});

const PORT = SERVER_PORT;
const own = (handle: string) => `${handle}.localhost:${PORT}`;
const seeds: Record<"ascii" | "ext", Promise<Seeded>> = {} as never;

test.beforeAll(() => {
  seeds.ascii = seedFullPage("free");
  seeds.ext = seedFullPage("free", { name: "Łukasz Żółć" });
});
test.afterAll(cleanupUsers);

const fileOf = (family: string, weight: number, subset: string) =>
  FONT_MANIFEST.families[family]!.faces.find(
    (face) => face.weight === weight && face.subset === subset,
  )!.file;

async function visit(
  browser: import("@playwright/test").Browser,
  device: typeof PHONE | typeof DESKTOP,
  target: Seeded,
) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const recorder = await record(context, page);
  await page.goto(target.url);
  await recorder.settle();
  // The 'preloaded but not used' warning comes 3 seconds after load.
  await page.waitForTimeout(3200);
  return { context, page, recorder };
}

for (const [name, device] of [
  ["390x844", PHONE],
  ["1440x900", DESKTOP],
] as const) {
  test(`M8-01 ${name}: a first visit requests the Fraunces 700 and Inter 400 latin files from its own host and nothing else`, async ({
    browser,
  }) => {
    const target = await seeds.ascii;
    const { context, page, recorder } = await visit(browser, device, target);
    const seen = classify(recorder.entries(), own(target.handle));
    const names = seen.fonts.map((entry) => new URL(entry.url).pathname.split("/").pop());
    expect(names.sort()).toEqual(
      [fileOf("Fraunces", 700, "latin"), fileOf("Inter", 400, "latin")].sort(),
    );
    for (const entry of seen.fonts) {
      expect(new URL(entry.url).host).toBe(own(target.handle));
      expect(entry.mime).toBe("font/woff2");
      expect(entry.status).toBe(200);
    }
    // No other host, in particular none of Google's, and none of the HYDLNK UI's own fonts or CSS.
    expect(seen.thirdParty.map((entry) => entry.url)).toEqual([]);
    expect(
      recorder.entries().filter((entry) => /\/_next\/static\/(?:media|chunks)\//.test(entry.url)),
    ).toEqual([]);

    const head = await page.evaluate(() => ({
      stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
      hints: document.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"]').length,
      preloads: [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((link) => ({
        href: link.getAttribute("href"),
        type: link.getAttribute("type"),
        crossorigin: link.hasAttribute("crossorigin"),
      })),
      faces: [...document.fonts].map((face) => `${face.family}|${face.weight}|${face.status}`),
      fraunces: document.fonts.check('700 16px "Fraunces"'),
      inter: document.fonts.check('400 16px "Inter"'),
      scrollWidth: document.documentElement.scrollWidth <= window.innerWidth,
    }));
    expect(head.stylesheets).toBe(0);
    expect(head.hints).toBe(0);
    expect(head.preloads.map((link) => link.href).sort()).toEqual(
      [
        `/_t/f/${fileOf("Fraunces", 700, "latin")}`,
        `/_t/f/${fileOf("Inter", 400, "latin")}`,
      ].sort(),
    );
    for (const link of head.preloads) {
      expect(link.type).toBe("font/woff2");
      expect(link.crossorigin).toBe(true);
    }
    expect(head.fraunces).toBe(true);
    expect(head.inter).toBe(true);
    expect(head.faces.filter((face) => face.endsWith("|loaded")).length).toBe(2);
    expect(head.scrollWidth).toBe(true);
    // One request per file: the preload and the rule share it, and no 'preloaded but not used' warning.
    expect(seen.fonts).toHaveLength(2);
    expect(recorder.visit.console.filter((text) => /preload/i.test(text))).toEqual([]);
    await context.close();
  });
}

test("M8-01 a name that needs latin-ext also fetches the heading family's latin-ext file, and no other subset", async ({
  browser,
}) => {
  const target = await seeds.ext;
  const { context, recorder } = await visit(browser, DESKTOP, target);
  const seen = classify(recorder.entries(), own(target.handle));
  const names = seen.fonts.map((entry) => new URL(entry.url).pathname.split("/").pop()).sort();
  expect(names).toEqual(
    [
      fileOf("Fraunces", 700, "latin"),
      fileOf("Fraunces", 700, "latin-ext"),
      fileOf("Inter", 400, "latin"),
    ].sort(),
  );
  expect(recorder.visit.console.filter((text) => /preload/i.test(text))).toEqual([]);
  await context.close();
});

test("M8-01 a page with ASCII text never requests latin-ext", async ({ browser }) => {
  const target = await seeds.ascii;
  const { context, recorder } = await visit(browser, PHONE, target);
  expect(recorder.entries().filter((entry) => entry.url.includes("latin-ext"))).toEqual([]);
  await context.close();
});

test("M8-01 a second visit in the same context makes no font request (immutable, from the HTTP cache)", async ({
  browser,
}) => {
  const target = await seeds.ascii;
  const { context, page, recorder } = await visit(browser, DESKTOP, target);
  const before = recorder.entries().length;
  await page.reload();
  await recorder.settle();
  // The reload re-asks for the document and sends the beacon; a font the HTTP cache answers is not a
  // request to the network.
  const second = classify(
    recorder
      .entries()
      .slice(before)
      .filter((entry) => !entry.fromCache),
    own(target.handle),
  );
  expect(second.fonts).toEqual([]);
  expect(second.scripts).toEqual([]);
  await context.close();
});
