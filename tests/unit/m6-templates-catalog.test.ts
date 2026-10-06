import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_PATTERN,
  LIMITS,
  codePointLength,
  collectPublishErrors,
  draftDocSchema,
  emptyDraft,
  publishDocSchema,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import {
  TEMPLATES,
  TEMPLATE_IDS,
  applyTemplate,
  buildTemplateBlocks,
  templateById,
  templateNeedsConfirmation,
  type Template,
} from "@/lib/templates";

/**
 * M6-40: the template catalog is static data that can never put anything fake on a live page. The
 * browser flow (dialog, apply, undo, publish) is in tests/e2e/m6/templates*.spec.ts.
 */

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI = /[‪-‮⁦-⁩]/;

const withProfile = (): DraftDoc => emptyDraft("mara");
const applied = (template: Template): DraftDoc => applyTemplate(withProfile(), template);

/** Every text a template puts on a page, with the limit that field has. */
function texts(template: Template): { text: string; max: number; where: string }[] {
  const out: { text: string; max: number; where: string }[] = [
    { text: template.bio, max: LIMITS.bio, where: "bio" },
  ];
  for (const block of template.blocks) {
    switch (block.type) {
      case "header":
        out.push({ text: block.text, max: LIMITS.headerText, where: "header" });
        break;
      case "text":
        out.push({ text: block.text, max: LIMITS.text, where: "text" });
        break;
      case "link":
        out.push({ text: block.label, max: LIMITS.linkLabel, where: "link" });
        break;
      case "card":
        out.push({ text: block.title, max: LIMITS.cardTitle, where: "card title" });
        out.push({ text: block.caption, max: LIMITS.cardCaption, where: "card caption" });
        break;
      case "image":
        out.push({ text: block.alt, max: LIMITS.imageAlt, where: "image alt" });
        break;
      case "embed":
        out.push({ text: block.caption, max: LIMITS.embedCaption, where: "embed caption" });
        break;
      case "grid":
        for (const cell of block.cells) {
          out.push({ text: cell.title, max: LIMITS.cellTitle, where: "cell title" });
          out.push({ text: cell.subtitle, max: LIMITS.cellSubtitle, where: "cell subtitle" });
        }
        break;
      case "social":
        break;
    }
  }
  return out;
}

function idsOf(blocks: readonly Block[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    ids.push(block.id);
    if (block.type === "social") for (const icon of block.icons) ids.push(icon.id);
    if (block.type === "grid") for (const cell of block.cells) ids.push(cell.id);
  }
  return ids;
}

describe("M6-40 the catalog", () => {
  it("has six templates in order, with the names, descriptions and sample bios of the spec", () => {
    expect(TEMPLATES.map((template) => template.name)).toEqual([
      "Musician",
      "Podcaster",
      "Artist",
      "Shop",
      "Coach",
      "Streamer",
    ]);
    expect(TEMPLATES.map((template) => template.id)).toEqual([...TEMPLATE_IDS]);
    expect(TEMPLATES.map((template) => template.description)).toEqual([
      "A listen block, tour dates and merch.",
      "Listen links, your latest episode and a way to support the show.",
      "Your work, prints and commissions.",
      "Best sellers, new arrivals and order help.",
      "A booking link, a free guide and an intro video.",
      "Where to watch, your schedule and your community.",
    ]);
    expect(TEMPLATES.map((template) => template.bio)).toEqual([
      "New music, tour dates and merch.",
      "New episodes every week.",
      "Original work, prints and commissions.",
      "Small-batch goods, made to order.",
      "Clear steps, honest feedback, real results.",
      "Live most weeknights.",
    ]);
    expect(TEMPLATES.map((template) => template.theme.name)).toEqual([
      "Midnight",
      "Smoke",
      "Ivory",
      "Paper",
      "Sage",
      "Ember",
    ]);
  });

  it("each template builds the blocks of the spec, in order", () => {
    const summary = (template: Template) =>
      applied(template).blocks.map((block) => {
        switch (block.type) {
          case "header":
            return `header:${block.text}`;
          case "text":
            return `text:${block.text}`;
          case "link":
            return `link:${block.label}`;
          case "card":
            return `card:${block.title}|${block.caption}`;
          case "image":
            return `image:${block.alt}`;
          case "embed":
            return `embed:${block.caption}`;
          case "grid":
            return `grid:${block.cells.map((cell) => `${cell.title}/${cell.subtitle}`).join(",")}`;
          case "social":
            return `social:${block.icons.map((icon) => icon.platform).join(",")}`;
          case "divider":
            return "divider";
        }
      });
    expect(summary(templateById("musician")!)).toEqual([
      "header:Listen now",
      "embed:Latest release",
      "link:Tour dates",
      "link:Merch",
      "card:New single|Out now",
      "social:instagram,tiktok,youtube",
    ]);
    expect(summary(templateById("podcaster")!)).toEqual([
      "header:Listen on",
      "link:Apple Podcasts",
      "link:Spotify",
      "link:YouTube",
      "embed:Latest episode",
      "text:New episodes every Tuesday. Subscribe so you never miss one.",
      "link:Support the show",
      "social:instagram,x,email",
    ]);
    expect(summary(templateById("artist")!)).toEqual([
      "image:Featured artwork",
      "header:Work",
      "grid:Prints/Shop the archive,Originals/Available now",
      "link:Commission a piece",
      "text:Commissions open this season.",
      "social:instagram,threads,email",
    ]);
    expect(summary(templateById("shop")!)).toEqual([
      "header:Shop",
      "card:Best sellers|Shop now",
      "grid:New in/This week,On sale/While it lasts",
      "link:Visit the shop",
      "link:Track my order",
      "text:Free shipping on orders over $50.",
      "social:instagram,tiktok,email",
    ]);
    expect(summary(templateById("coach")!)).toEqual([
      "text:Work with me one on one or join a small group.",
      "link:Book a free call",
      "card:Free starter guide|Download",
      "link:Join the newsletter",
      "embed:Watch an intro",
      "social:linkedin,instagram,email",
    ]);
    expect(summary(templateById("streamer")!)).toEqual([
      "link:Watch live",
      "link:Stream schedule",
      "grid:Discord/Join the chat,Clips/Best moments",
      "link:Support the stream",
      "social:youtube,tiktok,x",
    ]);
  });

  it("every template, with its generated ids and a profile, passes the draft schema; none has more than 50 blocks", () => {
    for (const template of TEMPLATES) {
      const doc = applied(template);
      const parsed = draftDocSchema.safeParse(doc);
      expect(
        parsed.success,
        `${template.name}: ${parsed.success ? "" : parsed.error.message}`,
      ).toBe(true);
      expect(doc.blocks.length).toBeGreaterThan(0);
      expect(doc.blocks.length).toBeLessThanOrEqual(50);
      expect(doc.blocks.every((block) => block.visible === true)).toBe(true);
    }
  });

  it("uses only the nine existing block types and fields that exist today", () => {
    const allowed = new Set([
      "link",
      "card",
      "header",
      "text",
      "image",
      "social",
      "embed",
      "grid",
      "divider",
    ]);
    for (const template of TEMPLATES) {
      for (const block of applied(template).blocks) expect(allowed.has(block.type)).toBe(true);
    }
  });

  it("every text is within its limit and has no control or bidi characters", () => {
    for (const template of TEMPLATES) {
      for (const { text, max, where } of texts(template)) {
        expect(text.trim(), `${template.name} ${where}`).toBe(text);
        expect(text.length, `${template.name} ${where} is not empty`).toBeGreaterThan(0);
        expect(codePointLength(text), `${template.name} ${where}`).toBeLessThanOrEqual(max);
        expect(CONTROL.test(text), `${template.name} ${where} has a control character`).toBe(false);
        expect(BIDI.test(text), `${template.name} ${where} has a bidi character`).toBe(false);
      }
    }
  });

  it("theme references are the fixed ids of system themes that a migration ships, six different ones from Noir to Ember", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const shipped = new Map<string, string>();
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, file), "utf8");
      for (const match of sql.matchAll(
        /'(00000000-0000-4000-8000-0000000000\d\d)',\s*null,\s*'([A-Za-z]+)'/g,
      )) {
        shipped.set(match[1]!, match[2]!);
      }
    }
    const noirToEmber = ["Noir", "Ivory", "Smoke", "Paper", "Sage", "Midnight", "Ember"];
    for (const template of TEMPLATES) {
      expect(shipped.get(template.theme.id), `${template.name} theme id`).toBe(template.theme.name);
      expect(noirToEmber).toContain(template.theme.name);
    }
    expect(new Set(TEMPLATES.map((template) => template.theme.id)).size).toBe(6);
  });

  it("page-level overrides are empty and the theme reference is the template's", () => {
    for (const template of TEMPLATES) {
      const doc = applied(template);
      expect(doc.theme).toEqual({ ref: template.theme.id, overrides: {} });
    }
  });

  it("holds no link address, embed address, email address or image reference: nothing fake can go live", () => {
    for (const template of TEMPLATES) {
      // The catalog has no field for one...
      const source = JSON.stringify(template);
      expect(source, `${template.name} data`).not.toMatch(
        /https?:|@|www\.|\.com\b|"(url|address|image|src|href|photo|path|email)":/i,
      );
      // ...so every generated one is empty.
      for (const block of applied(template).blocks) {
        if (block.type === "link" || block.type === "embed") expect(block.url).toBe("");
        if (block.type === "card") {
          expect(block.url).toBe("");
          expect(block.image).toBeNull();
        }
        if (block.type === "image") {
          expect(block.image).toBeNull();
          expect(block.url ?? "").toBe("");
        }
        if (block.type === "grid") for (const cell of block.cells) expect(cell.url).toBe("");
        if (block.type === "social") {
          for (const icon of block.icons) {
            if (icon.platform === "email") expect(icon.address).toBe("");
            else expect(icon.url).toBe("");
          }
        }
      }
      // So Publish refuses every template until its addresses are filled in.
      expect(publishDocSchema.safeParse(applied(template)).success, template.name).toBe(false);
    }
  });

  it("Musician stops Publish at five blocks: the embed, the two links, the card and the social row", () => {
    const doc = applied(templateById("musician")!);
    const errors = collectPublishErrors(doc);
    const failing = new Set(errors.map((error) => error.blockId));
    expect(failing.size).toBe(5);
    const byId = new Map(doc.blocks.map((block) => [block.id, block]));
    expect([...failing].map((id) => byId.get(id!)!.type).sort()).toEqual(
      ["card", "embed", "link", "link", "social"].sort(),
    );
    // The header has nothing to fill in.
    expect(failing.has(doc.blocks[0]!.id)).toBe(false);
  });

  it("the catalog and builder import no Supabase client and make no network call", () => {
    const dir = join(process.cwd(), "src", "lib", "templates");
    for (const file of ["catalog.ts", "build.ts", "index.ts"]) {
      const source = readFileSync(join(dir, file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/supabase/i);
      expect(code, file).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|WebSocket|server-only|process\.env/,
      );
      for (const match of code.matchAll(/from\s+"([^"]+)"/g)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(
          /^(@\/lib\/(document|editor\/duplicate)|\.\/)/,
        );
      }
    }
  });
});

describe("M6-40 applying", () => {
  it("applying one template twice gives two block lists whose ids never overlap, all in the id pattern, none repeated within a page", () => {
    for (const template of TEMPLATES) {
      const first = applyTemplate(withProfile(), template);
      const second = applyTemplate(first, template);
      const a = idsOf(first.blocks);
      const b = idsOf(second.blocks);
      expect(new Set(a).size, `${template.name} first page`).toBe(a.length);
      expect(new Set(b).size, `${template.name} second page`).toBe(b.length);
      expect(
        a.filter((id) => b.includes(id)),
        `${template.name} overlap`,
      ).toEqual([]);
      for (const id of [...a, ...b]) expect(id).toMatch(BLOCK_ID_PATTERN);
      expect(draftDocSchema.safeParse(second).success).toBe(true);
    }
  });

  it("buildTemplateBlocks never reuses an id it was told is taken", () => {
    const taken = new Set<string>();
    const one = buildTemplateBlocks(templateById("shop")!, taken);
    const used = new Set(idsOf(one));
    expect(taken).toEqual(used);
    const two = buildTemplateBlocks(templateById("shop")!, taken);
    expect(idsOf(two).filter((id) => used.has(id))).toEqual([]);
  });

  it("replaces the blocks and the theme, clears the page-level overrides, and touches nothing else", () => {
    const photo = {
      path: "00000000-0000-4000-8000-000000000001/abcdefgh12.webp",
      width: 400,
      height: 400,
    };
    const before: DraftDoc = {
      ...withProfile(),
      rev: 9,
      profile: {
        ...withProfile().profile,
        name: "Mara Okafor",
        bio: "My own bio",
        photo,
        photoShape: "square",
      },
      theme: {
        ref: "00000000-0000-4000-8000-000000000001",
        overrides: { accent: "#C46A4F", radius: 20 },
      },
      blocks: [{ id: "OldBlock0001", type: "header", visible: true, text: "Old" }],
    };
    const frozen = JSON.parse(JSON.stringify(before)) as DraftDoc;
    Object.freeze(before.profile);
    Object.freeze(before.theme);
    Object.freeze(before.blocks);
    Object.freeze(before);
    const musician = templateById("musician")!;
    const next = applyTemplate(before, musician);

    expect(next.blocks).toHaveLength(6);
    expect(next.theme).toEqual({ ref: musician.theme.id, overrides: {} });
    expect(next.rev).toBe(9);
    // The name, the photo, the photo options and a bio the person wrote stay.
    expect(next.profile).toEqual(frozen.profile);
    // The input is untouched.
    expect(JSON.parse(JSON.stringify(before))).toEqual(frozen);
    expect(before.theme.overrides).toEqual({ accent: "#C46A4F", radius: 20 });
  });

  it("sets the sample bio only when the bio is empty (blank counts as empty)", () => {
    const musician = templateById("musician")!;
    const empty = applyTemplate(withProfile(), musician);
    expect(empty.profile.bio).toBe("New music, tour dates and merch.");
    const blank = applyTemplate(
      { ...withProfile(), profile: { ...withProfile().profile, bio: "   " } },
      musician,
    );
    expect(blank.profile.bio).toBe("New music, tour dates and merch.");
    const own = applyTemplate(
      { ...withProfile(), profile: { ...withProfile().profile, bio: "Mine" } },
      musician,
    );
    expect(own.profile.bio).toBe("Mine");
    expect(empty.profile.name).toBe("mara");
    expect(empty.profile.photo).toBeNull();
  });

  it("a replace can never push a page past 50 blocks", () => {
    const fifty = {
      ...withProfile(),
      blocks: Array.from({ length: 50 }, (_, i): Block => ({
        id: `Blk${String(i).padStart(6, "0")}`,
        type: "text",
        visible: true,
        text: `Text ${i}`,
      })),
    };
    for (const template of TEMPLATES) {
      expect(applyTemplate(fifty, template).blocks.length).toBe(template.blocks.length);
      expect(applyTemplate(fifty, template).blocks.length).toBeLessThanOrEqual(50);
    }
  });

  it("asks before replacing anything the person made, and not on an empty page", () => {
    const musician = templateById("musician")!;
    expect(templateNeedsConfirmation(withProfile())).toBe(false);
    const block: Block = { id: "OneBlock0001", type: "header", visible: true, text: "Hi" };
    expect(templateNeedsConfirmation({ ...withProfile(), blocks: [block] })).toBe(true);
    expect(
      templateNeedsConfirmation({
        ...withProfile(),
        theme: { ref: null, overrides: { accent: "#C46A4F" } },
      }),
    ).toBe(true);
    expect(
      templateNeedsConfirmation({
        ...withProfile(),
        theme: { ref: "00000000-0000-4000-8000-000000000001", overrides: {} },
      }),
    ).toBe(true);
    // Any theme on the page asks, even the template's own: the plain reading of "a theme ... changes".
    expect(
      templateNeedsConfirmation({
        ...withProfile(),
        theme: { ref: musician.theme.id, overrides: {} },
      }),
    ).toBe(true);
  });

  it("an id that is not in the catalog finds nothing", () => {
    expect(templateById("nope")).toBeNull();
    expect(templateById("")).toBeNull();
    expect(templateById("__proto__")).toBeNull();
  });
});
