import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { rawRequest, restAs } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { accessToken, openEditor, pageRow, previewScreen, seededUser } from "../m2/editor-helpers";
import { liveHtml, seedTheme, setTheme } from "../m3/themes-helpers";
import { setOverrides } from "../m3/design-helpers";
import { resolveTokens, tokenSetSchema, TOKEN_KEYS, type TokenSet } from "@/lib/theme";

// The token schema only accepts a background image on this project's Storage origin.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= supabaseUrl();

/**
 * M6-41: the gradient tokens, through the real screens: the editor preview and the public page
 * draw the stored direction and colors, Publish freezes them, and a hostile value written straight
 * to the database (RLS lets a draft take anything) never reaches a stylesheet, a Publish or a
 * visitor. Every test makes its own user (a copy of mara's published page); mara is only read.
 */

test.afterAll(cleanupUsers);

const SMOKE = "00000000-0000-4000-8000-000000000003";
const CUSTOM = {
  bgType: "gradient",
  gradientAngle: 135,
  gradientFrom: "#C46A4F",
  gradientTo: "#1B1814",
} as const;
/** What Chrome reports for the custom gradient above. */
const CUSTOM_GRADIENT = "linear-gradient(135deg, rgb(196, 106, 79) 0%, rgb(27, 24, 20) 100%)";

const rgb = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
/** Chrome serializes the default direction (180deg, to bottom) by leaving it out. */
const withoutDefaultAngle = (value: string): string =>
  value.replace("linear-gradient(180deg, ", "linear-gradient(");

const root = (page: Page) => previewScreen(page).locator("[data-page-root]");
const styleOf = (page: Page, property: string) =>
  root(page).evaluate((el, name) => getComputedStyle(el).getPropertyValue(name).trim(), property);
const alertOf = (page: Page) => page.getByRole("alert").filter({ hasText: /before publishing/ });
const publishButton = (page: Page) =>
  page.locator("main > header").getByRole("button", { name: "Publish", exact: true });

/**
 * Publishes the draft from the editor and waits for the "Published" chip. Unlike the screen helper
 * it waits for the editor to hydrate before the click, so a loaded machine cannot swallow it.
 */
async function publishFromEditor(page: Page): Promise<void> {
  await openEditor(page);
  await publishButton(page).click();
  await expect(page.locator("[data-publish-status]")).toHaveText("Published", { timeout: 20_000 });
}

/** The live page, in a new tab of `context`, at the current viewport. */
async function openLive(context: BrowserContext, handle: string): Promise<Page> {
  const live = await context.newPage();
  await live.goto(`http://${handle}.localhost:3000/`);
  await expect(live.locator("[data-page-root]")).toBeVisible();
  return live;
}

test.describe("M6-41 the editor preview and the public page", () => {
  test("M6-41 a custom gradient: the preview root carries the three variables and the gradient; the live page changes only after Publish", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "1440x900 flow; the layout is checked at both sizes below");
    const user = await seededUser(context, "gt1");
    await setOverrides(user.pageId, CUSTOM);
    await openEditor(page);

    expect(await styleOf(page, "--t-gradient-angle")).toBe("135deg");
    expect(await styleOf(page, "--t-gradient-from")).toBe("#C46A4F");
    expect(await styleOf(page, "--t-gradient-to")).toBe("#1B1814");
    expect(await styleOf(page, "background-image")).toBe(CUSTOM_GRADIENT);
    await expect(root(page)).toHaveAttribute("data-bg-type", "gradient");

    // Before Publish the live page still shows the old background (Noir, solid).
    const live = await openLive(context, user.handle);
    await expect(live.locator("[data-page-root]")).toHaveAttribute("data-bg-type", "solid");
    expect(
      await live.locator("[data-page-root]").evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toBe("none");

    await publishFromEditor(page);
    await live.reload();
    const liveRoot = live.locator("[data-page-root]");
    await expect(liveRoot).toHaveAttribute("data-bg-type", "gradient");
    expect(await liveRoot.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(
      CUSTOM_GRADIENT,
    );
    await live.close();
  });

  test("M6-41 the Smoke system theme still draws the M3-14 gradient: surface at 0% to bg at 55%, top to bottom", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "1440x900 flow");
    const user = await seededUser(context, "gt2");
    await setTheme(user.pageId, SMOKE, {});
    const smoke = await adminClient().from("themes").select("tokens").eq("id", SMOKE).single();
    const tokens = smoke.data!.tokens as TokenSet;
    // A system theme carries the gradient defaults (the migration added them).
    expect(tokens).toMatchObject({ gradientAngle: 180, gradientFrom: null, gradientTo: null });

    await openEditor(page);
    expect(await styleOf(page, "--t-gradient-angle")).toBe("180deg");
    expect(await styleOf(page, "--t-gradient-from")).toBe(tokens.surface);
    expect(await styleOf(page, "--t-gradient-to")).toBe(tokens.bg);
    expect(withoutDefaultAngle(await styleOf(page, "background-image"))).toBe(
      `linear-gradient(${rgb(tokens.surface)} 0%, ${rgb(tokens.bg)} 55%)`,
    );
    // No stops of its own: the renderer does not mark it as a custom gradient.
    await expect(root(page)).not.toHaveAttribute("data-gradient", /.*/);

    // The angle alone (both colors still null) keeps today's stops.
    await setOverrides(user.pageId, { gradientAngle: 90 });
    await openEditor(page);
    expect(await styleOf(page, "background-image")).toBe(
      `linear-gradient(90deg, ${rgb(tokens.surface)} 0%, ${rgb(tokens.bg)} 55%)`,
    );
  });

  test("M6-41 Publish freezes the three tokens: the page's overrides, then the theme, then the defaults", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "data flow: one viewport");
    const user = await seededUser(context, "gt3");

    // Defaults only (Noir has no gradient settings of its own beyond the migration's).
    await publishFromEditor(page);
    let stored = (await pageRow(user.pageId)).published as { tokens: TokenSet };
    expect(Object.keys(stored.tokens).sort()).toEqual([...TOKEN_KEYS].sort());
    expect(stored.tokens).toMatchObject({
      gradientAngle: 180,
      gradientFrom: null,
      gradientTo: null,
    });

    // A saved theme with a direction and a first color, and a page override of the direction.
    const theme = await seedTheme(user.userId, "Gradient look", {
      gradientAngle: 90,
      gradientFrom: "#112233",
    });
    await setTheme(user.pageId, theme.id, { gradientAngle: 45 });
    await publishFromEditor(page);
    stored = (await pageRow(user.pageId)).published as { tokens: TokenSet };
    expect(stored.tokens.gradientAngle).toBe(45); // the page
    expect(stored.tokens.gradientFrom).toBe("#112233"); // the theme
    expect(stored.tokens.gradientTo).toBeNull(); // the default
    const themeRow = await adminClient()
      .from("themes")
      .select("tokens")
      .eq("id", theme.id)
      .single();
    expect(stored.tokens).toEqual(
      resolveTokens(tokenSetSchema.partial().parse(themeRow.data!.tokens), { gradientAngle: 45 }),
    );
    // A theme saved now carries all 26 keys, well under the 8192-byte cap.
    const keys = Object.keys(themeRow.data!.tokens as object);
    expect(keys).toHaveLength(26);
    expect(JSON.stringify(themeRow.data!.tokens).length).toBeLessThan(8192);
  });
});

test.describe("M6-41 hostile values", () => {
  /** PATCH the stored draft through PostgREST with the user's JWT and the publishable key. */
  async function patchOverrides(
    context: BrowserContext,
    pageId: string,
    overrides: Record<string, unknown>,
  ): Promise<void> {
    const row = await pageRow(pageId);
    const draft = {
      ...JSON.parse(JSON.stringify(row.draft)),
      theme: { ref: row.draft.theme.ref, overrides },
    };
    const result = await restAs(await accessToken(context), `/pages?id=eq.${pageId}`, {
      method: "PATCH",
      body: { draft },
    });
    expect(result.status, "RLS accepts a draft write").toBeLessThan(300);
    expect(Array.isArray(result.body) && result.body.length === 1).toBe(true);
  }

  const HOSTILE: { name: string; overrides: Record<string, unknown>; message: RegExp }[] = [
    {
      name: "gradientAngle '45deg; background:url(//evil.example/x)'",
      overrides: { bgType: "gradient", gradientAngle: "45deg; background:url(//evil.example/x)" },
      message: /Publish stopped: Gradient direction isn’t valid\. Reset it in Design\./,
    },
    {
      name: "gradientFrom '#FFF;}</style><script>window.__x=1</script>'",
      overrides: {
        bgType: "gradient",
        gradientFrom: "#FFF;}</style><script>window.__x=1</script>",
      },
      message: /Publish stopped: Gradient start color isn’t a valid color\. Reset it in Design\./,
    },
    {
      name: "gradientTo 'red'",
      overrides: { bgType: "gradient", gradientTo: "red" },
      message: /Publish stopped: Gradient end color isn’t a valid color\. Reset it in Design\./,
    },
    {
      name: "gradientAngle 181",
      overrides: { bgType: "gradient", gradientAngle: 181 },
      message: /Publish stopped: Gradient direction isn’t valid\. Reset it in Design\./,
    },
  ];

  for (const { name, overrides, message } of HOSTILE) {
    test(`M6-41 ${name} is a valid draft write, the preview shows nothing of it, and Publish refuses and changes nothing`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "security flow: one viewport, the layout is checked below");
      const user = await seededUser(context, "gt4");
      const before = await pageRow(user.pageId);
      const liveBefore = await liveHtml(user.handle);

      await patchOverrides(context, user.pageId, overrides);
      await openEditor(page);

      // The preview draws the default: no script element, nothing run, the value is the default.
      expect(
        await page.evaluate(() => (window as unknown as { __x?: unknown }).__x),
      ).toBeUndefined();
      expect(
        await page.evaluate(() =>
          Array.from(document.scripts).some((script) =>
            script.textContent?.includes("window.__x=1"),
          ),
        ),
      ).toBe(false);
      expect(await styleOf(page, "--t-gradient-angle")).toBe("180deg");
      const html = await page.content();
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain("<script>window.__x");

      await publishButton(page).click();
      const alert = alertOf(page);
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(message);
      const after = await pageRow(user.pageId);
      expect(JSON.stringify(after.published)).toBe(JSON.stringify(before.published));
      expect(after.published_at).toBe(before.published_at);
      const live = await liveHtml(user.handle);
      expect(live).toBe(liveBefore);
      expect(live).not.toContain("evil.example");
      expect(live).not.toContain("<script>window.__x");
    });
  }

  test("M6-41 a saved theme whose tokens hold a hostile gradientFrom is ignored by Publish, like any theme whose tokens do not parse", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "security flow: one viewport");
    const user = await seededUser(context, "gt5");
    const token = await accessToken(context);
    const hostile = {
      ...resolveTokens(null, {}),
      gradientFrom: "#FFF;}</style><script>window.__x=1</script>",
    };
    // PostgREST only checks the size of a theme's tokens, so the row is accepted.
    const inserted = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: user.userId, name: "Hostile gradient", tokens: hostile },
    });
    expect(inserted.status, JSON.stringify(inserted.body)).toBeLessThan(300);
    const themeId = (inserted.body as { id: string }[])[0]!.id;

    await setTheme(user.pageId, themeId, { accent: "#C46A4F" });
    await publishFromEditor(page);

    const stored = (await pageRow(user.pageId)).published as { tokens: TokenSet };
    // Resolved as if the page had no theme: the system default plus the page's own overrides.
    expect(stored.tokens).toEqual(resolveTokens(null, { accent: "#C46A4F" }));
    expect(JSON.stringify(stored)).not.toContain("window.__x");
    const live = await liveHtml(user.handle);
    expect(live).not.toContain("window.__x");
    expect(live).not.toContain("</style><script>");
  });

  for (const [key, value] of [
    ["gradientFrom", "#FFF;}</style><script>window.__x=1</script>"],
    ["gradientAngle", "45deg; background:url(//evil.example/x)"],
    ["gradientTo", "red"],
  ] as const) {
    test(`M6-41 a published row holding a hostile ${key} serves the 404 page and never emits the value`, async ({
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "security flow: one viewport");
      const user = await seededUser(context, "gt6");
      const row = await pageRow(user.pageId);
      const published = row.published as { tokens: Record<string, unknown> };
      const written = {
        ...published,
        tokens: { ...published.tokens, bgType: "gradient", [key]: value },
      };
      const { error } = await adminClient()
        .from("pages")
        .update({ published: written })
        .eq("id", user.pageId);
      expect(error).toBeNull();

      // The first request for this page: nothing cached for it yet, so what is served is what the
      // gate decides now. It fails closed.
      const response = await rawRequest(`${user.handle}.localhost:3000`, "/");
      expect(response.status).toBe(404);
      expect(response.body).not.toContain("evil.example");
      expect(response.body).not.toContain("window.__x");
      expect(response.body).not.toContain("</style><script>");
      expect(response.body).not.toContain("--t-gradient");
    });
  }
});

test.describe("M6-41 the public page at both sizes", () => {
  test("M6-41 a published 135 degree gradient fills the viewport; no horizontal scroll, every link 44px (phone); it spans the full width and height behind the 480px column (desktop)", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "gt7");
    await setOverrides(user.pageId, CUSTOM);
    await publishFromEditor(page);

    const live = await openLive(context, user.handle);
    const viewport = live.viewportSize()!;
    const liveRoot = live.locator("[data-page-root]");
    expect(await liveRoot.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(
      CUSTOM_GRADIENT,
    );
    const box = (await liveRoot.boundingBox())!;
    // The gradient spans the whole viewport: from the top left corner, the full width, and at
    // least the full height, so no strip below a short page is left unfilled.
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.y)).toBe(0);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(viewport.height);
    expect(await live.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    if (info.project.name === "phone") {
      await expectNoHorizontalScroll(live);
      await expectTapTargets(live, ".pg-link, .pg-card, .pg-grid a");
    } else {
      const column = (await live.locator(".pg-column").boundingBox())!;
      expect(Math.round(column.width)).toBe(480);
      expect(box.width).toBeGreaterThan(column.width * 2);
    }
    await live.close();
  });

  test("M6-41 on a one-block page the gradient still fills the viewport, with no unfilled strip below the content", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gt8");
    const row = await pageRow(user.pageId);
    const draft = {
      ...row.draft,
      blocks: row.draft.blocks.filter((block) => block.type === "header").slice(0, 1),
      theme: { ref: SMOKE, overrides: {} },
    };
    expect(draft.blocks).toHaveLength(1);
    const { error } = await adminClient().from("pages").update({ draft }).eq("id", user.pageId);
    expect(error).toBeNull();
    await publishFromEditor(page);

    const live = await openLive(context, user.handle);
    const viewport = live.viewportSize()!;
    const liveRoot = live.locator("[data-page-root]");
    expect(await liveRoot.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(
      /^linear-gradient\(/,
    );
    const box = (await liveRoot.boundingBox())!;
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(viewport.height);
    // Below the content the page is the gradient, not a lighter body: nothing but the root paints there.
    const body = await live.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      bodyBackground: getComputedStyle(document.body).backgroundImage,
    }));
    expect(body.scrollHeight).toBeLessThanOrEqual(
      Math.max(body.innerHeight, Math.round(box.height)) + 1,
    );
    expect(body.bodyBackground).toBe("none");
    await live.close();
  });
});
