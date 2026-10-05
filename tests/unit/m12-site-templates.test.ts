import { describe, expect, it } from "vitest";
import {
  LIMITS,
  codePointLength,
  draftDocSchema,
  draftSubPageSchema,
  emptyDraft,
  pageLinkTargetErrors,
  publishDocSchema,
  publishSubPageSchema,
  publishedDocSchema,
  publishedSubPageSchema,
  siteBlockIdClashes,
  sitePathClashes,
  suggestPath,
  toPublishForm,
  toSubPagePublishForm,
  type Block,
} from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";
import { PLAN_LIMITS } from "@/lib/limits/table";
import {
  SITE_TEMPLATES,
  SITE_TEMPLATE_IDS,
  instantiateSiteTemplate,
  siteTemplateById,
} from "@/lib/site-templates/catalog";

/**
 * M12-03: the three site templates are static data that publishes as it is. Every document passes
 * the draft schemas and the publish forms with real page ids filled in, the whole site fits the Free
 * plan, and the texts are plainly samples. The browser flow is in tests/e2e/m12/editor-templates.
 */

const PAGE_IDS = [
  "6f1c2b9e-4a53-4f7d-9d80-1a2b3c4d5e61",
  "6f1c2b9e-4a53-4f7d-9d80-1a2b3c4d5e62",
] as const;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function build(id: (typeof SITE_TEMPLATE_IDS)[number]) {
  const template = siteTemplateById(id)!;
  const made = instantiateSiteTemplate(template);
  const home = made.home(emptyDraft("mara"), PAGE_IDS);
  return { template, made, home };
}

describe("site templates (M12-03)", () => {
  it("offers exactly garage sale, small business and musician, with three pages each", () => {
    expect(SITE_TEMPLATES.map((t) => t.id)).toEqual([...SITE_TEMPLATE_IDS]);
    expect(SITE_TEMPLATES.map((t) => t.pages)).toEqual([
      ["Home", "Items", "Directions"],
      ["Home", "Menu or services", "Visit"],
      ["Home", "Shows", "Merch"],
    ]);
    for (const template of SITE_TEMPLATES) {
      expect(template.pages[0]).toBe("Home");
      expect(template.subPages.map((p) => p.title)).toEqual(template.pages.slice(1));
      // Home and two pages: fits the Free plan.
      expect(1 + template.subPages.length).toBeLessThanOrEqual(PLAN_LIMITS.free.pagesPerSite);
    }
  });

  for (const id of SITE_TEMPLATE_IDS) {
    describe(id, () => {
      it("Home passes the draft schema, the publish gate and the published schema", () => {
        const { home } = build(id);
        expect(draftDocSchema.safeParse(home).success).toBe(true);
        const gate = publishDocSchema.safeParse(home);
        expect(gate.success, JSON.stringify(gate.error?.issues)).toBe(true);
        const stored = publishedDocSchema.safeParse(toPublishForm(home, null));
        expect(stored.success, JSON.stringify(stored.error?.issues)).toBe(true);
        expect(home.blocks.length).toBeLessThanOrEqual(LIMITS.blocks);
        expect(jsonbTextBytes(home)).toBeLessThanOrEqual(LIMITS.draftBytes);
      });

      it("each page passes the draft schema, the publish gate and the published schema", () => {
        const { made, template } = build(id);
        const used: string[] = [];
        for (const page of made.pages) {
          const path = suggestPath(page.title, used);
          used.push(path);
          const doc = {
            path,
            title: page.title,
            description: page.description,
            blocks: page.blocks,
          };
          expect(draftSubPageSchema.safeParse(doc).success).toBe(true);
          const gate = publishSubPageSchema.safeParse(doc);
          expect(gate.success, JSON.stringify(gate.error?.issues)).toBe(true);
          const stored = publishedSubPageSchema.safeParse(toSubPagePublishForm(doc));
          expect(stored.success, JSON.stringify(stored.error?.issues)).toBe(true);
          expect(doc.blocks.length).toBeGreaterThan(0);
        }
        expect(sitePathClashes(used.map((path, i) => ({ id: PAGE_IDS[i]!, path })))).toEqual([]);
        expect(template.subPages).toHaveLength(2);
      });

      it("ids are unique across the site and Home's page links name the new pages", () => {
        const { made, home } = build(id);
        const subs = made.pages.map((page, i) => ({ id: PAGE_IDS[i]!, blocks: page.blocks }));
        expect(siteBlockIdClashes(home, subs)).toEqual([]);
        expect(
          pageLinkTargetErrors(
            [
              { pageId: "home", blocks: home.blocks },
              ...subs.map((s) => ({ pageId: s.id, blocks: s.blocks })),
            ],
            PAGE_IDS,
          ),
        ).toEqual([]);
        const targets = home.blocks.flatMap((b) => (b.type === "page_link" ? [b.target] : []));
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) expect(PAGE_IDS).toContain(target);
        expect(home.nav).toEqual({ show: true, items: [...PAGE_IDS] });
      });

      it("uses fresh ids on every instantiate and avoids ids already on the site", () => {
        const template = siteTemplateById(id)!;
        const ids = (taken?: Set<string>) => {
          const made = instantiateSiteTemplate(template, taken);
          const home = made.home(emptyDraft("mara"), PAGE_IDS);
          return JSON.stringify([home.blocks, ...made.pages.map((p) => p.blocks)]).match(
            /"(?:id|googleId|appleId)":"([^"]+)"/g,
          )!;
        };
        const first = ids();
        const second = ids();
        expect(new Set(first).size).toBe(first.length);
        expect(first.filter((x) => second.includes(x))).toEqual([]);
      });

      it("is sample text with no photos, no outside links and nothing fake that goes live", () => {
        const { made, home } = build(id);
        const blocks: Block[] = [...home.blocks, ...made.pages.flatMap((p) => p.blocks)];
        const json = JSON.stringify([home, made.pages]);
        expect(json).not.toMatch(/https?:\/\//);
        expect(json).not.toMatch(/"image":\{/);
        expect(json).not.toMatch(/"photo":\{/);
        for (const block of blocks) {
          // A block that needs the owner's own address is hidden and has none.
          if (block.type === "embed") {
            expect(block.visible).toBe(false);
            expect(block.url).toBe("");
          }
          if (block.type === "link") throw new Error("a template has no outside link");
        }
        expect(home.profile.bio.startsWith("Sample")).toBe(true);
        for (const page of made.pages) expect(json).toContain(page.description);
        for (const match of json.matchAll(
          /"(?:text|name|description|label|caption|heading)":"([^"]*)"/g,
        )) {
          expect(CONTROL.test(match[1]!)).toBe(false);
          expect(codePointLength(match[1]!)).toBeGreaterThan(0);
        }
      });

      it("keeps the owner's name and bio, takes the theme and menu", () => {
        const template = siteTemplateById(id)!;
        const current = {
          ...emptyDraft("mara"),
          profile: { ...emptyDraft("mara").profile, name: "Mara", bio: "My own bio" },
        };
        const home = instantiateSiteTemplate(template).home(current, PAGE_IDS);
        expect(home.profile.name).toBe("Mara");
        expect(home.profile.bio).toBe("My own bio");
        expect(home.theme).toEqual({ ref: template.theme.id, overrides: {} });
        expect(home.rev).toBe(current.rev);
      });
    });
  }
});
