import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  toPublishForm,
} from "@/lib/document";

/**
 * The local demo tenant `mara` (supabase/seed.sql) must stay a valid page document, and her
 * published copy must be exactly the publish form of her draft, so the editor shows "Published"
 * (M2-27) after `pnpm db:reset`. The static half reads the seed file; the live half reads the
 * seeded rows from the local stack and is skipped without one (REQUIRE_SUPABASE=1 makes a missing
 * stack an error, like the ensure-account integration test).
 */

const seed = readFileSync(resolve(process.cwd(), "supabase/seed.sql"), "utf8");
const draftJson: unknown = JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(seed)![1]!);

const MARA_BLOCK_IDS = {
  social: "Sx4kT9pLq2Wa",
  header: "Hd7mN3cYb8Ue",
  link: ["Bt5rJ1fGz6Os", "Qw8vC2nKd4Ly"],
  card: "Lc6hP0yRe3Zi",
  embed: "Ym1gA5uVf7Tx",
  grid: "Jn9bE4sXo2Mq",
  divider: "Vk3wD8tHa5Pr",
  text: "Ge2zU7qNc9Fl",
  image: "Im4gB6kWs8Xz",
};

describe("seed.sql: mara's draft", () => {
  const draft = draftDocSchema.parse(draftJson);

  it("passes the draft and the publish schemas with no errors", () => {
    expect(publishDocSchema.safeParse(draftJson).success).toBe(true);
    expect(collectPublishErrors(draftJson)).toEqual([]);
  });

  it("uses the Noir theme and has every original block type, the image block hidden", () => {
    expect(draft.theme).toEqual({ ref: "00000000-0000-4000-8000-000000000001", overrides: {} });
    // The seed predates the Wave K blocks (M9-15 appends them after the nine originals) and stays as it is.
    expect(new Set(draft.blocks.map((b) => b.type))).toEqual(new Set(BLOCK_TYPES.slice(0, 9)));
    expect(draft.blocks.filter((b) => !b.visible).map((b) => b.id)).toEqual([MARA_BLOCK_IDS.image]);
  });

  it("keeps the ids the tests target", () => {
    const ids = draft.blocks.map((b) => b.id);
    expect(ids).toEqual([
      MARA_BLOCK_IDS.social,
      MARA_BLOCK_IDS.header,
      ...MARA_BLOCK_IDS.link,
      MARA_BLOCK_IDS.card,
      MARA_BLOCK_IDS.embed,
      MARA_BLOCK_IDS.grid,
      MARA_BLOCK_IDS.divider,
      MARA_BLOCK_IDS.text,
      MARA_BLOCK_IDS.image,
    ]);
  });
});

function loadEnvLocal(): boolean {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !process.env[match[1]!])
        process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
    }
    return Boolean(process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return false;
  }
}

const haveEnv = loadEnvLocal();
let stackUp = false;
if (haveEnv) {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
      signal: AbortSignal.timeout(2000),
    });
    stackUp = res.ok;
  } catch {
    stackUp = false;
  }
}
if (process.env.REQUIRE_SUPABASE === "1" && !(haveEnv && stackUp)) {
  throw new Error(
    "REQUIRE_SUPABASE=1, but the local Supabase stack or .env.local is not available",
  );
}

describe.skipIf(!haveEnv || !stackUp)("seeded mara rows (local Supabase)", () => {
  it("published is exactly the publish form of the draft under the stored Noir theme", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );
    const page = await admin.from("pages").select("draft, published").eq("handle", "mara").single();
    expect(page.error).toBeNull();
    const theme = await admin
      .from("themes")
      .select("tokens")
      .eq("id", "00000000-0000-4000-8000-000000000001")
      .single();
    expect(theme.error).toBeNull();

    const draft = draftDocSchema.parse(page.data!.draft);
    const published = publishedDocSchema.parse(page.data!.published);
    const expected = toPublishForm(draft, theme.data!.tokens as Record<string, never>);
    expect(publishFormsEqual(published, expected)).toBe(true);
    expect(published.blocks.map((b) => b.id)).not.toContain(MARA_BLOCK_IDS.image);
    expect(published.blocks).toHaveLength(draft.blocks.length - 1);
  });
});
