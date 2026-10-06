import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { waitForEditorHydrated } from "../m2/editor-helpers";

/**
 * M9-02: Lucide icons in the app. One smoke per flow on both projects: the six app screens draw
 * their icons with no console error or warning and no request to a host that is not ours, every
 * icon-only control keeps its 44px target, and an icon follows its control's color in every state.
 */

test.afterAll(cleanupUsers);

// Six screens are compiled on demand by the dev server the first time: give a run room.
test.describe.configure({ timeout: 120_000 });

const SCREENS = ["/editor", "/design", "/share", "/analytics", "/domains", "/settings"];

/**
 * The hosts the app talks to in local development: the app, its Supabase API, and two that exist
 * without Lucide: the Design screen's theme-font preview (Google Fonts, until the preview fonts
 * are self-hosted) and the person's own page address (Share tab). An icon never adds a host: the
 * library is bundled.
 */
const PORT = process.env.HL_DEV_PORT ?? "3000";
const OWN_HOSTS = new Set([
  `app.localhost:${PORT}`,
  `localhost:${PORT}`,
  "127.0.0.1:54321",
  "localhost:54321",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);
const isOwn = (host: string) => OWN_HOSTS.has(host) || host.endsWith(`.localhost:${PORT}`);

async function settle(page: Page, route: string) {
  await page.goto(url("app", route));
  if (route === "/editor") await waitForEditorHydrated(page);
  await page.waitForLoadState("networkidle");
}

test.describe("M9-02 icons on the app screens", () => {
  test("M9-02 the six screens log no console error or warning and call no host but our own", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "ic1" });
    const problems: string[] = [];
    const foreign = new Set<string>();
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        problems.push(`${message.type()}: ${message.text().slice(0, 200)}`);
      }
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("request", (request) => {
      const { host, protocol } = new URL(request.url());
      if (protocol.startsWith("http") && !isOwn(host)) foreign.add(host);
    });
    for (const route of SCREENS) {
      await settle(page, route);
      await expectNoHorizontalScroll(page);
    }
    expect(problems).toEqual([]);
    expect([...foreign]).toEqual([]);
  });

  test("M9-02 every icon is decorative and every icon-only control is at least 44x44", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "ic2" });
    for (const route of SCREENS) {
      await settle(page, route);
      const report = await page.evaluate(() => {
        const bad: string[] = [];
        let icons = 0;
        for (const svg of document.querySelectorAll<SVGElement>("svg.lucide")) {
          icons += 1;
          if (svg.getAttribute("aria-hidden") !== "true") bad.push("an icon is not aria-hidden");
          if (svg.getAttribute("focusable") !== "false") bad.push("an icon is focusable");
          if (svg.querySelector("title")) bad.push("an icon has a <title>");
          const control = svg.closest<HTMLElement>("button, a[href]");
          if (!control) continue;
          // The "+" between two blocks is a 20px hairline where there is a mouse (M6-04 step 7).
          if (
            control.parentElement?.hasAttribute("data-add-slot") &&
            window.matchMedia("(hover: hover) and (min-width: 760px)").matches
          ) {
            continue;
          }
          const rect = control.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const name = (control.textContent ?? "").trim();
          const label = control.getAttribute("aria-label") ?? name ?? control.tagName;
          if (rect.height < 43.5) bad.push(`${label}: ${Math.round(rect.height)}px tall`);
          if (name === "" && rect.width < 43.5)
            bad.push(`${label}: ${Math.round(rect.width)}px wide`);
          if (
            name === "" &&
            !control.getAttribute("aria-label") &&
            !control.getAttribute("title")
          ) {
            bad.push(`an icon-only control has no name (${control.tagName})`);
          }
        }
        return { bad, icons };
      });
      expect(report.icons, route).toBeGreaterThan(0);
      expect(report.bad, route).toEqual([]);
    }
  });

  test("M9-02 an icon takes its control's color: sidebar items, Undo and the phone tab bar", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "ic3" });
    await settle(page, "/editor");
    const stroke = (locator: ReturnType<Page["locator"]>) =>
      locator.evaluate((svg) => getComputedStyle(svg).stroke);
    const color = (locator: ReturnType<Page["locator"]>) =>
      locator.evaluate((node) => getComputedStyle(node).color);

    // Undo is disabled at the start of the history: the icon still reads the button's color.
    const undo = page.locator("[data-history-button='undo']");
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(await stroke(undo.locator("svg"))).toBe(await color(undo));
    expect(await undo.locator("svg").getAttribute("width")).toBe("18");

    if (desktopOnly(info)) {
      const links = page.getByRole("navigation", { name: "App", exact: true }).getByRole("link");
      for (let index = 0; index < 3; index += 1) {
        const link = links.nth(index);
        const svg = link.locator("svg");
        const box = await svg.boundingBox();
        expect(box!.width).toBe(16);
        const holder = svg.locator("xpath=..");
        const active = (await link.getAttribute("aria-current")) === "page";
        // The current item's icon is brass (its wrapper's color); the others follow the link.
        expect(await stroke(svg)).toBe(await color(active ? holder : link));
      }
    }
    if (phoneOnly(info)) {
      const tabs = page.getByRole("navigation", { name: "App sections", exact: true });
      const items = tabs.getByRole("link");
      await expect(items).toHaveCount(4);
      for (let index = 0; index < 4; index += 1) {
        const item = items.nth(index);
        const svg = item.locator("svg");
        expect((await svg.boundingBox())!.width).toBe(20);
        expect(await stroke(svg)).toBe(await color(item));
      }
      // The selected tab is Editor and its icon is the ink of its label.
      const selected = tabs.locator("a[aria-current='page']");
      await expect(selected).toHaveCount(1);
      expect(await stroke(selected.locator("svg"))).toBe("rgb(28, 27, 26)");
    }
  });
});
