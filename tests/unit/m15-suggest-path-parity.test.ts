// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { suggestPath } from "@/lib/document/path";
import { stackIsUp } from "./publish-support";

const { run } = await stackIsUp();

const fixed = [
  "",
  " ",
  "---",
  "About us",
  "About Us!!",
  "Café Menü Ångström",
  "Ünïcödé Tïtle",
  "İstanbul",
  "日本語のページ",
  "😀 party 😀",
  "ＦＵＬＬ ｗｉｄｔｈ",
  "ﬁne ﬂour",
  // Unicode 16+ compatibility letters, which Postgres 15.1 does not decompose.
  "\u{1CCD6}\u{1CCD7}",
  "Shop \u{1CCF1}",
  "\u{1CCD7}\u{1CCDB}",
  "api",
  "API",
  "og",
  "sitemap",
  "404-not-found",
  "hl-query-count",
  "hl-hl-x",
  "hl-",
  "hl",
  "HL",
  "HL-Test",
  "-lead",
  "trail---",
  "a",
  "a--b",
  "x".repeat(40),
  "x".repeat(41),
  "x".repeat(120),
  `${"a".repeat(38)}-b-c`,
  `${"a".repeat(39)}-bcd`,
  `${"ab-".repeat(20)}end`,
];

function makeTitles(): { title: string; taken: string[] }[] {
  const words = [
    "blog",
    "shop",
    "api",
    "media",
    "r",
    "c",
    "t",
    "page",
    "links",
    "hl-x",
    "Åbo",
    "über",
    "q&a",
  ];
  const out: { title: string; taken: string[] }[] = [];
  for (const title of fixed) {
    out.push({ title, taken: [] });
    out.push({ title, taken: [suggestPath(title)] });
  }
  let i = 0;
  while (out.length < 200) {
    const title = `${words[i % words.length]} ${words[(i * 7 + 3) % words.length]} ${i % 4 === 0 ? "" : i}`;
    const base = suggestPath(title);
    const taken = [base, `${base}-2`, `${base}-3`].slice(0, (i % 3) + 1);
    if (i % 5 === 0) taken.push("page", "page-2");
    out.push({ title, taken });
    i += 1;
  }
  return out;
}

describe.skipIf(!run)("suggest_site_path matches suggestPath", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);

  it("gives the same result for 200 titles with taken sets", async () => {
    const cases = makeTitles();
    expect(cases.length).toBeGreaterThanOrEqual(200);
    const mismatches: string[] = [];
    for (const { title, taken } of cases) {
      const { data, error } = await admin.rpc("suggest_site_path", {
        p_title: title,
        p_taken: taken,
      });
      expect(error, JSON.stringify({ title, taken })).toBeNull();
      const want = suggestPath(title, taken);
      if (data !== want)
        mismatches.push(`${JSON.stringify(title)} taken=${taken}: sql=${data} ts=${want}`);
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});
